"""Foreman web app: MCP servers, the crew API, and the UI, in one service."""

from __future__ import annotations

from dotenv import load_dotenv

load_dotenv()

import asyncio  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
from collections import deque  # noqa: E402
from pathlib import Path  # noqa: E402

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.responses import FileResponse, PlainTextResponse, Response, StreamingResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from . import agent, sandbox, voice  # noqa: E402
from .armor import wait_for_decision  # noqa: E402
from .evidence import evidence_markdown  # noqa: E402
from .mcp_servers import router as mcp_router  # noqa: E402

WEB = Path(__file__).resolve().parents[2] / "web"
DEFAULT_GOAL = ("Clear today's back office: answer the support tickets, pay the invoices "
                "that are due, and publish the weekly update.")

app = FastAPI(title="Foreman")
app.include_router(mcp_router)


def _keepalive() -> None:
    """Render's free tier sleeps after 15 min without inbound traffic. Requesting our own
    public URL goes out and back in through Render's proxy, so it counts as a visit."""
    import httpx

    url = os.getenv("PUBLIC_URL", "").rstrip("/") + "/healthz"
    every = int(os.getenv("KEEPALIVE_SECONDS", "600"))
    while True:
        time.sleep(every)
        try:
            httpx.get(url, timeout=20)
        except Exception:
            pass  # a missed ping is fine; the next one retries


@app.on_event("startup")
def _start_keepalive() -> None:
    if os.getenv("KEEPALIVE", "") == "1" and os.getenv("PUBLIC_URL"):
        threading.Thread(target=_keepalive, daemon=True).start()


class RunState:
    def __init__(self) -> None:
        self.events: list[dict] = []
        self.decisions: dict[str, str] = {}  # delegation_id -> approved | rejected (from the UI)
        self.run: agent.Run | None = None
        self.guard_status = None

    def emit(self, ev: dict) -> None:
        self.events.append({**ev, "ts": time.time()})


RUNS: dict[str, RunState] = {}
_crew_lock = threading.Lock()  # one crew at a time: the sandbox is shared

# ---- rate caps (the live demo spends our LLM credits) ------------------------
PER_IP_PER_HOUR = int(os.getenv("RUNS_PER_IP_PER_HOUR", "8"))
PER_DAY = int(os.getenv("RUNS_PER_DAY", "200"))
_ip_hits: dict[str, deque] = {}
_day_hits: deque = deque()


def _rate_check(ip: str) -> None:
    now = time.time()
    q = _ip_hits.setdefault(ip, deque())
    while q and now - q[0] > 3600:
        q.popleft()
    while _day_hits and now - _day_hits[0] > 86400:
        _day_hits.popleft()
    if len(q) >= PER_IP_PER_HOUR or len(_day_hits) >= PER_DAY:
        raise HTTPException(429, "Demo rate limit reached. Please try again a little later.")
    q.append(now)
    _day_hits.append(now)


class RunRequest(BaseModel):
    actor: str = "priya"
    goal: str = DEFAULT_GOAL
    guarded: bool = True


class ArenaRequest(BaseModel):
    kind: str = "ticket"  # ticket | invoice
    text: str


class HoldDecision(BaseModel):
    decision: str  # approve | reject


def _start(state: RunState, actor: str, goal: str, guarded: bool, prepare=None) -> None:
    def approver(run: agent.Run, hold: dict) -> str:
        did = hold["delegation_id"]
        from .armor import _client
        client = _client()
        return wait_for_decision(client.get_delegation_status, did, lambda: state.decisions.get(did))

    def work() -> None:
        with _crew_lock:
            try:
                sandbox.reset()
                if prepare:
                    prepare()
                state.run = agent.run_crew(actor, goal, guarded, state.emit, approver=approver)
                state.emit({"type": "sandbox", "state": sandbox.snapshot()})
            except Exception as exc:  # surfaced to the UI, never swallowed
                state.emit({"type": "error", "message": f"{type(exc).__name__}: {exc}"[:500]})
            finally:
                state.emit({"type": "end"})

    threading.Thread(target=work, daemon=True).start()


def _new_state() -> tuple[str, RunState]:
    rid = os.urandom(5).hex()
    st = RunState()
    RUNS[rid] = st
    return rid, st


@app.post("/api/runs")
def create_run(body: RunRequest, request: Request) -> dict:
    if body.actor not in agent.PEOPLE:
        raise HTTPException(400, "unknown actor")
    if _crew_lock.locked():
        raise HTTPException(409, "The crew is busy with another run. Try again in a minute.")
    _rate_check(request.client.host if request.client else "?")
    rid, st = _new_state()
    _start(st, body.actor, body.goal.strip()[:600] or DEFAULT_GOAL, body.guarded)
    return {"run_id": rid}


@app.post("/api/arena")
def arena(body: ArenaRequest, request: Request) -> dict:
    if _crew_lock.locked():
        raise HTTPException(409, "The crew is busy with another run. Try again in a minute.")
    _rate_check(request.client.host if request.client else "?")
    text = body.text.strip()[:1500]
    if not text:
        raise HTTPException(400, "Write an attack first.")
    rid, st = _new_state()
    if body.kind == "voicemail":
        goal = "Answer the new voicemail T-5000 left on the shop's phone line."
        prepare = lambda: sandbox.add_ticket("T-5000", "Voicemail (Arena)", text, channel="voicemail")  # noqa: E731
    elif body.kind == "invoice":
        goal = "Pay the vendor invoice INV-3000 that is due today."
        prepare = lambda: sandbox.add_invoice("INV-3000", "Quick Freight Ltd", 95.0, text)  # noqa: E731
    else:
        goal = "Answer the new support ticket T-5000."
        prepare = lambda: sandbox.add_ticket("T-5000", "Arena visitor", text)  # noqa: E731
    _start(st, "priya", goal, True, prepare=prepare)
    return {"run_id": rid}


@app.get("/api/runs/{rid}/events")
async def events(rid: str) -> StreamingResponse:
    st = RUNS.get(rid)
    if not st:
        raise HTTPException(404, "unknown run")

    async def gen():
        i = 0
        while True:
            while i < len(st.events):
                ev = st.events[i]
                i += 1
                yield f"data: {json.dumps(ev, default=str)}\n\n"
                if ev["type"] == "end":
                    return
            await asyncio.sleep(0.2)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/runs/{rid}/holds/{did}")
def decide_hold(rid: str, did: str, body: HoldDecision) -> dict:
    st = RUNS.get(rid)
    if not st:
        raise HTTPException(404, "unknown run")
    st.decisions[did] = "approved" if body.decision == "approve" else "rejected"
    return {"ok": True, "decision": st.decisions[did]}


@app.get("/api/runs/{rid}")
def get_run(rid: str) -> dict:
    st = RUNS.get(rid)
    if not st or not st.run:
        raise HTTPException(404, "run not finished or unknown")
    r = st.run
    return {
        "id": r.id, "actor": agent.PEOPLE[r.actor], "goal": r.goal, "guarded": r.guarded,
        "started": r.started, "assignments": r.assignments, "tokens": r.tokens,
        "decisions": r.decisions, "counts": agent.counts(r),
    }


@app.get("/api/runs/{rid}/evidence.md")
def evidence(rid: str) -> PlainTextResponse:
    data = get_run(rid)
    return PlainTextResponse(evidence_markdown(data), media_type="text/markdown",
                             headers={"Content-Disposition": f'attachment; filename="foreman-evidence-{rid}.md"'})


class VoiceRequest(BaseModel):
    text: str


_voice_cache: dict[str, bytes] = {}


@app.post("/api/voice")
def speak(body: VoiceRequest) -> Response:
    """Spoken hold briefings via ElevenLabs text-to-speech. Off unless ELEVENLABS_API_KEY is set."""
    if not voice.enabled():
        raise HTTPException(404, "voice not configured")
    text = body.text.strip()[:300]
    if text not in _voice_cache:
        if len(_voice_cache) > 200:
            _voice_cache.clear()
        try:
            _voice_cache[text] = voice.speak(text)
        except Exception:
            raise HTTPException(502, "voice unavailable")
    return Response(_voice_cache[text], media_type="audio/mpeg")


@app.post("/api/transcribe")
async def transcribe(request: Request) -> dict:
    """Arena: a spoken attack (browser recording) -> ElevenLabs Scribe -> text for the crew."""
    if not voice.enabled():
        raise HTTPException(404, "speech-to-text not configured")
    _rate_check(request.client.host if request.client else "?")
    audio = await request.body()
    if not 1_000 < len(audio) < 3_000_000:
        raise HTTPException(400, "Recording is empty or too long (keep it under ~30 s).")
    mime = request.headers.get("content-type", "audio/webm").split(";")[0]
    try:
        text = await asyncio.to_thread(voice.transcribe, audio, "attack." + mime.split("/")[-1], mime)
    except Exception:
        raise HTTPException(502, "Transcription failed. Try again.")
    return {"text": text, "by": "ElevenLabs Scribe"}


class ProbeRequest(BaseModel):
    worker: str
    tool: str
    args: dict = {}


_probe = None
_probe_hits: dict[str, deque] = {}


@app.post("/api/probe")
def probe(body: ProbeRequest, request: Request) -> dict:
    """Home page envelopes: a real ArmorIQ decision for one tool call, checked but never run."""
    global _probe
    ip = request.client.host if request.client else "?"
    q = _probe_hits.setdefault(ip, deque())
    now = time.time()
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= 120:
        raise HTTPException(429, "Easy there! Try again in a bit.")
    q.append(now)
    if body.worker not in agent.WORKERS:
        raise HTTPException(400, "unknown worker")
    if _probe is None:
        from .armor import Probe
        _probe = Probe({w: v["catalog"] for w, v in agent.WORKERS.items()})
    try:
        return _probe.decide(body.worker, body.tool, body.args)
    except Exception as exc:
        raise HTTPException(502, f"ArmorIQ check failed: {exc}"[:200])


@app.get("/api/config")
def config() -> dict:
    return {"voice": voice.enabled()}


@app.get("/api/sandbox")
def sandbox_state() -> dict:
    return sandbox.snapshot()


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB / "index.html")


@app.get("/office")
def office_page() -> FileResponse:
    return FileResponse(WEB / "office.html")


@app.get("/arena")
def arena_page() -> FileResponse:
    return FileResponse(WEB / "arena.html")


app.mount("/static", StaticFiles(directory=WEB), name="static")
