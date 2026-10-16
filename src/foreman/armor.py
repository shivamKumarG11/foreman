"""ArmorIQ guard: signs each worker's slice and routes every tool call through the proxy.

Uses only public armoriq-sdk 0.6.10 calls:
  capture_plan -> get_intent_token      (one scoped token per worker)
  invoke(mcp, action, token, params, user_email)
      -> proxy verifies the token's Merkle proof, checks org policy, forwards to MCP
  create_delegation_request / get_delegation_status   (hold -> human approval)
The hold flow mirrors ArmorIQClient.invoke_with_policy, with events surfaced to the UI.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any, Callable

from armoriq_sdk import ArmorIQClient
from armoriq_sdk.exceptions import (
    IntentMismatchException,
    InvalidTokenException,
    MCPInvocationException,
    PolicyBlockedException,
    PolicyHoldException,
)
from armoriq_sdk.models import DelegationRequestParams

from . import mcp_servers

FOREMAN_MODEL = os.getenv("FOREMAN_MODEL", "anthropic/claude-sonnet-5.5")
APPROVAL_TIMEOUT_S = float(os.getenv("APPROVAL_TIMEOUT_S", "180"))


@dataclass
class Verdict:
    verdict: str  # allowed | blocked | held | approved | rejected | error
    reason: str
    result: Any = None
    delegation_id: str | None = None


def _client() -> ArmorIQClient:
    cred = {"authType": "bearer", "token": os.environ["MCP_TOKEN"]}
    return ArmorIQClient(
        api_key=os.environ["ARMORIQ_API_KEY"],
        user_id="foreman-service",
        agent_id="foreman",
        mcp_credentials={mcp_servers.armoriq_name(n): cred for n in mcp_servers.SERVERS},
    )


def _parse_result(r: Any) -> tuple[bool, Any]:
    """MCPInvocationResult.result is the MCP `result` object: {content: [...], isError}."""
    raw = getattr(r, "result", r)
    is_error = bool(isinstance(raw, dict) and raw.get("isError"))
    try:
        text = raw["content"][0]["text"]
        try:
            return is_error, json.loads(text)
        except (TypeError, ValueError):
            return is_error, text
    except (KeyError, IndexError, TypeError):
        return is_error, raw


class Guard:
    def __init__(self, user_email: str, goal: str, emit: Callable[[dict], None], approver: Callable[[dict], str]):
        self.client = _client()
        self.user_email = user_email
        self.goal = goal
        self.emit = emit
        self.approver = approver  # blocks until "approved" | "rejected" | "timeout"
        self.slices: dict[str, tuple[Any, set[str]]] = {}

    # ---- signing -------------------------------------------------------------

    def sign(self, worker: str, task: str, tools: list[str]) -> dict:
        plan = {
            "goal": f"[{worker}] {task}",
            "steps": [{"action": t, "mcp": mcp_servers.armoriq_name(mcp_servers.TOOL_SERVER[t]), "params": {}} for t in tools],
        }
        capture = self.client.capture_plan(
            llm=FOREMAN_MODEL, prompt=self.goal, plan=plan,
            metadata={"worker": worker, "requested_by": self.user_email},
        )
        token = self.client.get_intent_token(capture, validity_seconds=900)
        self.slices[worker] = (token, set(tools))
        return {
            "plan_id": token.plan_id,
            "plan_hash": token.plan_hash,
            "token_id": token.token_id,
            "expires_at": token.expires_at,
            "tools": tools,
        }

    # ---- every tool call -----------------------------------------------------

    def call(self, worker: str, tool: str, args: dict) -> Verdict:
        if tool not in mcp_servers.TOOL_SERVER:
            return Verdict("blocked", f"unknown tool '{tool}'")
        server = mcp_servers.armoriq_name(mcp_servers.TOOL_SERVER[tool])
        token, allowed = self.slices[worker]
        try:
            r = self.client.invoke(server, tool, token, params=args, user_email=self.user_email)
            is_err, data = _parse_result(r)
            if is_err:
                return Verdict("error", str(data)[:300])
            return Verdict("allowed", "in the signed work order and allowed by policy", result=data)
        except IntentMismatchException:
            return Verdict("blocked", f"'{tool}' is not in the {worker} worker's signed work order (plan {token.plan_hash[:12]}...)")
        except PolicyBlockedException as e:
            return Verdict("blocked", e.reason or str(e))
        except PolicyHoldException as e:
            return self._hold(worker, server, tool, args, token, e)
        except (MCPInvocationException, InvalidTokenException) as e:
            return Verdict("blocked" if tool not in allowed else "error", str(e)[:300])

    # ---- hold -> human approval -> retry ---------------------------------------

    def _hold(self, worker: str, server: str, tool: str, args: dict, token: Any, exc: PolicyHoldException) -> Verdict:
        ctx = exc.delegation_context or {}
        amount = float(args.get("amount") or 0) or 0.01
        reason = str(exc) or "held for approval"
        try:
            d = self.client.create_delegation_request(DelegationRequestParams(
                tool=tool, action="execute", arguments=args, amount=amount,
                requester_email=self.user_email, requester_role="agent_user", requester_limit=0,
                domain=ctx.get("domain", server), target_url=ctx.get("targetUrl"),
                plan_id=ctx.get("planId") or token.plan_id,
                intent_reference=ctx.get("intentReference") or token.token_id,
                merkle_root=ctx.get("merkleRoot") or token.plan_hash,
                reason=reason,
            ))
            delegation_id = d.delegation_id
        except Exception as de:  # nothing to approve -> stays held, fails closed
            return Verdict("held", f"{reason} (delegation request failed: {de})")

        hold = {"worker": worker, "tool": tool, "args": args, "reason": reason, "delegation_id": delegation_id}
        self.emit({"type": "hold", **hold})
        outcome = self.approver(hold)
        if outcome != "approved":
            return Verdict("rejected" if outcome == "rejected" else "held",
                           "manager rejected it" if outcome == "rejected" else "no approval in time; failed closed",
                           delegation_id=delegation_id)
        retry = dict(args, _delegation_id=delegation_id, _approvals=999)
        try:
            r = self.client.invoke(server, tool, token, params=retry, user_email=self.user_email)
            self.client.mark_delegation_executed(self.user_email, delegation_id, token.plan_id)
            _is_err, data = _parse_result(r)
            return Verdict("approved", "approved by a manager, then executed", result=data, delegation_id=delegation_id)
        except Exception as e:
            return Verdict("error", f"approved but retry failed: {e}"[:300], delegation_id=delegation_id)

    # ---- approval status (polled by the web app) -----------------------------

    def delegation_status(self, delegation_id: str) -> str:
        return self.client.get_delegation_status(delegation_id)


def wait_for_decision(client_status: Callable[[str], str], delegation_id: str, local_flag: Callable[[], str | None]) -> str:
    """Wait for either an ArmorIQ-side decision (dashboard) or the in-app button."""
    deadline = time.time() + APPROVAL_TIMEOUT_S
    while time.time() < deadline:
        local = local_flag()
        if local:
            return local
        try:
            status = client_status(delegation_id)
            if status in ("approved", "rejected"):
                return status
            if status == "expired":
                return "timeout"
        except Exception:
            pass
        time.sleep(2.0)
    return "timeout"


class Probe:
    """Real ArmorIQ decisions for single tool calls, without running them.

    Used by the home page's envelopes. Each worker's slice is signed once (capture_plan ->
    get_intent_token inside an ArmorIQ session) and every envelope is checked by ArmorIQ's
    proxy in enforce-only mode, so the answer is ArmorIQ's, and the sandbox is never touched.
    """

    def __init__(self, slices: dict[str, list[str]], user_email: str = "priya@acme.coffee"):
        from armoriq_sdk.session import SessionOptions

        self._opts = SessionOptions
        self.client = _client()
        self.user_email = user_email
        self.slices = slices
        self.sessions: dict[str, tuple[Any, float]] = {}

    def _session(self, worker: str):
        s, expires = self.sessions.get(worker, (None, 0.0))
        if s is None or time.time() > expires - 60:
            s = self.client.for_user(self.user_email).start_session(self._opts(mode="proxy", validity_seconds=900))
            calls = [{"name": f"{mcp_servers.armoriq_name(mcp_servers.TOOL_SERVER[t])}__{t}", "args": {}} for t in self.slices[worker]]
            s.start_plan(calls, goal=f"[{worker}] home-page demo slice")
            self.sessions[worker] = (s, time.time() + 900)
        return s

    def decide(self, worker: str, tool: str, args: dict) -> dict:
        if tool not in mcp_servers.TOOL_SERVER:
            return {"verdict": "blocked", "reason": f"unknown tool '{tool}'"}
        name = f"{mcp_servers.armoriq_name(mcp_servers.TOOL_SERVER[tool])}__{tool}"
        r = self._session(worker).enforce(name, args)
        verdict = {"allow": "allowed", "allow_log": "allowed", "alert": "allowed", "hold": "held"}.get(r.action, "blocked")
        if r.allowed and verdict == "blocked":
            verdict = "allowed"
        return {"verdict": verdict, "reason": r.reason or ("allowed by policy" if verdict == "allowed" else r.action), "policy": r.matched_policy}
