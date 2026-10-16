"""Four Acme MCP servers in ArmorIQ's MCP format.

ArmorIQ format (docs: sdk/mcp-directory/mcp-format): JSON-RPC 2.0 over HTTP POST,
responses wrapped as Server-Sent Events (`event: message\\ndata: {...}\\n\\n`),
methods `initialize`, `tools/list`, `tools/call`.

Each server is mounted at /mcp/<server-id> and registered with ArmorIQ separately,
so the proxy forwards every allowed call here.
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from . import sandbox


def _schema(props: dict[str, tuple[str, str]], required: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {k: {"type": t, "description": d} for k, (t, d) in props.items()},
        "required": required,
    }


# server-id -> tool-name -> (description, input schema, implementation)
SERVERS: dict[str, dict[str, tuple[str, dict, Callable[..., Any]]]] = {
    "acme-crm": {
        "list_tickets": ("List open customer support tickets.", _schema({}, []), sandbox.list_tickets),
        "read_ticket": (
            "Read one support ticket, including the customer's message.",
            _schema({"ticket_id": ("string", "Ticket id, e.g. T-4411")}, ["ticket_id"]),
            sandbox.read_ticket,
        ),
        "reply_ticket": (
            "Send a reply to the customer on a ticket and mark it answered.",
            _schema({"ticket_id": ("string", "Ticket id"), "message": ("string", "Reply text")}, ["ticket_id", "message"]),
            sandbox.reply_ticket,
        ),
        "send_newsletter": (
            "Email a marketing newsletter to an audience (e.g. 'all-customers').",
            _schema(
                {"audience": ("string", "Audience"), "subject": ("string", "Subject"), "body": ("string", "Body")},
                ["audience", "subject", "body"],
            ),
            sandbox.send_newsletter,
        ),
    },
    "acme-invoices": {
        "list_due_invoices": ("List vendor invoices that are due.", _schema({}, []), sandbox.list_due_invoices),
        "read_invoice": (
            "Read one vendor invoice, including its memo.",
            _schema({"invoice_id": ("string", "Invoice id, e.g. INV-2205")}, ["invoice_id"]),
            sandbox.read_invoice,
        ),
    },
    "acme-payments": {
        "refund": (
            "Refund a customer for a ticket's order.",
            _schema({"ticket_id": ("string", "Ticket id"), "amount": ("number", "Amount in USD")}, ["ticket_id", "amount"]),
            sandbox.refund,
        ),
        "pay_invoice": (
            "Pay a vendor invoice from the operating account.",
            _schema({"invoice_id": ("string", "Invoice id"), "amount": ("number", "Amount in USD")}, ["invoice_id", "amount"]),
            sandbox.pay_invoice,
        ),
        "wire_transfer": (
            "Wire money to a bank account.",
            _schema(
                {"account": ("string", "Destination account"), "amount": ("number", "Amount in USD"), "memo": ("string", "Memo")},
                ["account", "amount"],
            ),
            sandbox.wire_transfer,
        ),
    },
    "acme-cms": {
        "publish_post": (
            "Publish a post on the Acme Coffee blog.",
            _schema({"title": ("string", "Post title"), "body": ("string", "Post body (markdown)")}, ["title", "body"]),
            sandbox.publish_post,
        ),
    },
}

# Which MCP server owns each tool (tool names are unique across servers).
TOOL_SERVER: dict[str, str] = {tool: srv for srv, tools in SERVERS.items() for tool in tools}


def call_tool(server: str, tool: str, args: dict) -> Any:
    """Run a tool directly (used by the MCP endpoint, and by the unguarded demo mode)."""
    _desc, _schema_, fn = SERVERS[server][tool]
    return fn(**(args or {}))


def tool_specs(server: str) -> list[dict]:
    return [{"name": n, "description": d, "inputSchema": s} for n, (d, s, _f) in SERVERS[server].items()]


def _sse(payload: dict) -> Response:
    return Response(f"event: message\ndata: {json.dumps(payload)}\n\n", media_type="text/event-stream")


router = APIRouter()


@router.post("/mcp/{server}")
async def mcp_endpoint(server: str, request: Request) -> Response:
    expected = os.getenv("MCP_TOKEN")
    if expected and request.headers.get("authorization") != f"Bearer {expected}":
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    if server not in SERVERS:
        return JSONResponse({"error": f"unknown MCP server {server}"}, status_code=404)
    try:
        msg = await request.json()
    except Exception:
        return _sse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
    rid, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}

    if method == "initialize":
        return _sse({
            "jsonrpc": "2.0", "id": rid,
            "result": {
                "protocolVersion": params.get("protocolVersion", "2024-11-05"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": server, "version": "1.0.0"},
            },
        })
    if method == "notifications/initialized":
        return Response(status_code=202)
    if method == "tools/list":
        return _sse({"jsonrpc": "2.0", "id": rid, "result": {"tools": tool_specs(server)}})
    if method == "tools/call":
        name, args = params.get("name"), params.get("arguments") or {}
        if name not in SERVERS[server]:
            return _sse({"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": f"Unknown tool: {name}"}})
        try:
            result = call_tool(server, name, args)
            return _sse({
                "jsonrpc": "2.0", "id": rid,
                "result": {"content": [{"type": "text", "text": json.dumps(result)}], "isError": False},
            })
        except Exception as exc:  # tool-level failure, reported per MCP spec
            return _sse({
                "jsonrpc": "2.0", "id": rid,
                "result": {"content": [{"type": "text", "text": f"Error: {exc}"}], "isError": True},
            })
    return _sse({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": f"Method not found: {method}"}})
