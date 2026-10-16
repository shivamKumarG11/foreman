"""Foreman web app: MCP servers, the crew API, and the UI, in one service."""

from __future__ import annotations

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI  # noqa: E402

from .mcp_servers import router as mcp_router  # noqa: E402

app = FastAPI(title="Foreman")
app.include_router(mcp_router)


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}
