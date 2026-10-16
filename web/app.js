// Foreman UI. Every animation on the stage is driven by a real decision event
// streamed from the server (ArmorIQ allow / block / hold), never by a timer.
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = { actor: "priya", guarded: true, running: false, counts: { allowed: 0, held: 0, blocked: 0 }, runId: null };
const WORKER_TITLES = { support: "Support worker", finance: "Finance worker", publisher: "Publisher" };
const FORBIDDEN = new Set(["send_newsletter", "wire_transfer"]);

// ---------------------------------------------------------------- routing
function route() {
  const [view, arg] = (location.hash.replace("#", "") || "office").split("/");
  for (const v of ["office", "arena", "receipt"]) $(`#view-${v}`).hidden = v !== view;
  $$(".top nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
  if (view === "receipt") loadReceipt(arg || store.get("lastRun", null));
  fitStage();
}
window.addEventListener("hashchange", route);

// ---------------------------------------------------------------- controls
$$("[data-actor]").forEach((b) => b.addEventListener("click", () => {
  state.actor = b.dataset.actor;
  $$("[data-actor]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
}));
$("#guardBtn").addEventListener("click", () => {
  state.guarded = !state.guarded;
  const g = $("#guardBtn");
  g.className = "guard " + (state.guarded ? "on" : "off");
  g.textContent = "ArmorIQ guard: " + (state.guarded ? "on" : "off");
  g.setAttribute("aria-pressed", String(state.guarded));
});

// ---------------------------------------------------------------- stage scaling
function fitStage() {
  const fit = $("#stageFit"), stage = $("#stage");
  if (!fit || !fit.clientWidth) return;
  const s = Math.min(1, fit.clientWidth / 900);
  stage.style.transform = `translateX(-50%) scale(${s})`;
  fit.style.height = `${470 * s}px`;
}
window.addEventListener("resize", fitStage);

// ---------------------------------------------------------------- words for tool calls
function describe(tool, a = {}) {
  const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  switch (tool) {
    case "list_tickets": return "List open tickets";
    case "read_ticket": return a.ticket_id === "T-4414" || a.ticket_id === "T-5000" ? `Listen to voicemail ${a.ticket_id}` : `Read ticket ${a.ticket_id || ""}`;
    case "reply_ticket": return `Reply to ${a.ticket_id || "a ticket"}`;
    case "refund": return `Refund ${money(a.amount)} on ${a.ticket_id || "an order"}`;
    case "send_newsletter": return `Email ${a.audience || "an audience"}: "${(a.subject || "").slice(0, 40)}"`;
    case "list_due_invoices": return "List due invoices";
    case "read_invoice": return `Read invoice ${a.invoice_id || ""}`;
    case "pay_invoice": return `Pay ${a.invoice_id || "an invoice"} ${money(a.amount)}`;
    case "wire_transfer": return `Wire ${money(a.amount)} to ${a.account || "an account"}`;
    case "publish_post": return `Publish "${(a.title || "a post").slice(0, 40)}"`;
    default: return tool;
  }
}
const isRead = (t) => /^(list_|read_)/.test(t);

// ---------------------------------------------------------------- stage animation (queued)
const POS = { inbox: [0, 0], gate: [312, -14], support: [574, -150], finance: [574, -20], publisher: [574, 110], bin: [204, 196], tray: [390, 160] };
const COLORS = { allowed: "#6EA8FF", approved: "#3EE08F", ran: "#FF5C7A", blocked: "#FF5C7A", rejected: "#FF5C7A", held: "#FFC53D", error: "#9AA3B2" };
let animQueue = Promise.resolve();
const heldEnvelopes = {};

function envelope(color) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 46 32");
  svg.setAttribute("class", "env");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<rect x="1" y="1" width="44" height="30" rx="5" fill="#F5F1E6" stroke="${color}" stroke-width="2"/><path d="M3 4 L23 18 L43 4" stroke="${color}" stroke-width="2" fill="none"/>`;
  $("#stage").appendChild(svg);
  return svg;
}
const tf = ([x, y], r = 0, s = 1) => `translate(${x}px, ${y}px) rotate(${r}deg) scale(${s})`;

function stamp(verdict) {
  const el = $("#stamp"), gate = $("#gate");
  const label = { allowed: "ALLOWED", approved: "APPROVED", blocked: "BLOCKED", rejected: "REJECTED", held: "HELD", ran: "NO GUARD", error: "ERROR" }[verdict] || verdict.toUpperCase();
  el.textContent = label;
  el.style.color = COLORS[verdict] === "#6EA8FF" ? "#3EE08F" : COLORS[verdict];
  el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  gate.classList.remove("flash-allowed", "flash-blocked", "flash-held");
  const f = { allowed: "allowed", approved: "allowed", blocked: "blocked", rejected: "blocked", ran: "blocked", held: "held" }[verdict];
  if (f) { gate.classList.add("flash-" + f); setTimeout(() => gate.classList.remove("flash-" + f), 700); }
}

function animate(d) {
  animQueue = animQueue.then(() => new Promise((done) => {
    const fast = isRead(d.tool) && d.verdict === "allowed";
    const dur = fast ? 650 : 1100;
    const env = envelope(COLORS[d.verdict] || "#9AA3B2");
    const desk = POS[d.worker] || POS.support;
    const toGate = env.animate([{ transform: tf(POS.inbox, -8, .8), opacity: 0 }, { transform: tf(POS.gate, 0, 1.05), opacity: 1 }], { duration: dur, easing: "cubic-bezier(.55,.05,.35,1)", fill: "forwards" });
    toGate.onfinish = () => {
      if (!fast || d.verdict !== "allowed") stamp(d.verdict);
      let path;
      if (d.verdict === "allowed" || d.verdict === "approved" || d.verdict === "ran") path = [{ transform: tf(POS.gate, 0, 1.05) }, { transform: tf(desk, -6, .9), opacity: 1 }, { transform: tf(desk, 0, .5), opacity: 0 }];
      else if (d.verdict === "held") path = [{ transform: tf(POS.gate, 0, 1.05) }, { transform: tf(POS.tray, 0, 1), opacity: 1 }];
      else path = [{ transform: tf(POS.gate, 0, 1.08) }, { transform: tf([POS.gate[0] - 30, POS.gate[1] + 6], -22, 1) }, { transform: tf(POS.bin, -75, .8), opacity: 1 }, { transform: tf(POS.bin, -80, .6), opacity: 0 }];
      const a = env.animate(path, { duration: fast ? 600 : 1200, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" });
      if (d.verdict === "blocked" || d.verdict === "rejected") { const dk = $(`#desk-${d.worker}`); dk?.classList.add("alarm"); setTimeout(() => dk?.classList.remove("alarm"), 600); }
      a.onfinish = () => {
        if (d.verdict === "held") { heldEnvelopes[d.delegation_id || "x"] = env; $("#holdTray").classList.add("glow"); }
        else env.remove();
        done();
      };
    };
  }));
}

function releaseHeld(did, verdict) {
  const env = heldEnvelopes[did];
  $("#holdTray").classList.remove("glow");
  if (!env) return;
  delete heldEnvelopes[did];
  const to = verdict === "approved" ? POS.finance : POS.bin;
  env.animate([{ transform: tf(POS.tray) }, { transform: tf(to, 0, .6), opacity: 0 }], { duration: 900, easing: "ease-in", fill: "forwards" }).onfinish = () => env.remove();
}

// ---------------------------------------------------------------- bubbles & desks
function bubble(id, text, ms = 3200) {
  const b = $(`#bubble-${id}`); if (!b) return;
  b.textContent = text; b.classList.add("show");
  clearTimeout(b._t); b._t = setTimeout(() => b.classList.remove("show"), ms);
}
function deskState(worker, text, active) {
  const st = $(`#st-${worker}`); if (st) st.textContent = text;
  const dk = $(`#desk-${worker}`); if (dk) { dk.classList.toggle("active", !!active); dk.classList.toggle("typing", !!active); }
}

// ---------------------------------------------------------------- feed & counts
function bump(kind) {
  const k = { approved: "allowed", rejected: "blocked", ran: "allowed" }[kind] || kind;
  if (!(k in state.counts)) return;
  state.counts[k]++;
  const el = $(`#k-${k}`); el.textContent = state.counts[k];
  el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
}
function feed(verdict, title, meta) {
  const ol = $("#feed");
  if (ol.firstElementChild?.classList.contains("muted")) ol.innerHTML = "";
  const li = document.createElement("li");
  const label = verdict === "ran" ? "RAN" : verdict.toUpperCase();
  li.innerHTML = `<span class="badge b-${esc(verdict)}">${esc(label)}</span><div><div class="t">${esc(title)}</div><div class="m">${esc(meta)}</div></div>`;
  ol.prepend(li);
}

function holdCard(ev) {
  const div = document.createElement("div");
  div.className = "holdcard";
  div.id = "hold-" + ev.delegation_id;
  div.innerHTML = `<div class="h">HELD · needs a manager</div>
    <div class="what">${esc(WORKER_TITLES[ev.worker])} wants to <b>${esc(describe(ev.tool, ev.args))}</b></div>
    <div class="meta"><div>tool · ${esc(ev.tool)}</div><div>why · ${esc(ev.reason)}</div><div>delegation · ${esc((ev.delegation_id || "").slice(0, 18))}</div></div>
    <div class="btns"><button type="button" class="approve">Approve</button><button type="button" class="reject">Reject</button></div>
    <small class="muted">Or decide it in the ArmorIQ dashboard. The crew waits either way.</small>`;
  const send = async (decision) => {
    $$("button", div).forEach((b) => (b.disabled = true));
    await fetch(`/api/runs/${state.runId}/holds/${ev.delegation_id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
  };
  $(".approve", div).addEventListener("click", () => send("approve"));
  $(".reject", div).addEventListener("click", () => send("reject"));
  $("#holds").prepend(div);
  speak(`${WORKER_TITLES[ev.worker]} wants to ${describe(ev.tool, ev.args)}. ArmorIQ is holding it for your approval.`);
}

// Optional spoken briefing (ElevenLabs via the server, if configured). Silent otherwise.
async function speak(text) {
  try {
    const r = await fetch("/api/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob());
    new Audio(url).play().catch(() => {});
  } catch { /* voice is optional */ }
}

// ---------------------------------------------------------------- the run
function resetOffice() {
  state.counts = { allowed: 0, held: 0, blocked: 0 };
  ["allowed", "held", "blocked"].forEach((k) => ($(`#k-${k}`).textContent = "0"));
  $("#feed").innerHTML = ""; $("#holds").innerHTML = "";
  $("#slices").innerHTML = '<li class="muted">The Foreman is planning…</li>';
  $("#moneyPanel").hidden = true;
  Object.keys(WORKER_TITLES).forEach((w) => deskState(w, "waiting", false));
  $("#unguardedBadge").hidden = state.guarded;
}

function handle(ev) {
  switch (ev.type) {
    case "run_start":
      $("#liveLabel").textContent = `Live · ${ev.actor.name}'s run`;
      $(".live").classList.add("on");
      bubble("foreman", "Planning from the request only. I haven't opened the inbox.");
      break;
    case "plan": {
      const ol = $("#slices"); ol.innerHTML = "";
      if (!ev.assignments.length) ol.innerHTML = '<li class="muted">The Foreman assigned no work for this request.</li>';
      for (const a of ev.assignments) {
        const li = document.createElement("li"); li.id = "slice-" + a.worker;
        li.innerHTML = `<span class="who w-${esc(a.worker)}">${esc(WORKER_TITLES[a.worker])}</span><span class="tools">${a.tools.map(esc).join(" · ")}</span><span class="hash">${state.guarded ? "signing…" : "not signed (guard off)"}</span>`;
        ol.appendChild(li);
      }
      bubble("foreman", `${ev.assignments.length} work orders. Signing each with ArmorIQ.`);
      break;
    }
    case "token": {
      const h = $(`#slice-${ev.worker} .hash`);
      if (h) h.textContent = `intent token ${ev.token_id.slice(0, 10)}… · plan ${ev.plan_hash.slice(0, 12)}…`;
      feed("info", `Signed ${WORKER_TITLES[ev.worker]}'s work order`, `ArmorIQ plan ${ev.plan_id}`);
      break;
    }
    case "worker_start": deskState(ev.worker, "working…", true); break;
    case "worker_done": deskState(ev.worker, ev.summary || "done", false); break;
    case "decision": {
      const verdict = state.guarded ? ev.verdict : "ran";
      animate({ ...ev, verdict });
      feed(verdict, describe(ev.tool, ev.args), `${WORKER_TITLES[ev.worker]} · ${ev.tool} · ${ev.reason}`);
      if (!isRead(ev.tool) || verdict !== "allowed") bump(verdict);
      if (["approved", "rejected", "held"].includes(ev.verdict) && ev.delegation_id) { $("#hold-" + ev.delegation_id)?.remove(); releaseHeld(ev.delegation_id, ev.verdict); }
      break;
    }
    case "hold": animate({ ...ev, verdict: "held" }); bump("held"); holdCard(ev); feed("held", describe(ev.tool, ev.args), `${WORKER_TITLES[ev.worker]} · ${ev.reason}`); break;
    case "sandbox": showMoney(ev.state); break;
    case "run_done": bubble("foreman", "Done. Receipt is ready.", 5000); break;
    case "error": feed("error", "Run failed", ev.message); break;
  }
}

function showMoney(s) {
  const ul = $("#money"); ul.innerHTML = "";
  const rows = [];
  for (const e of s.ledger) rows.push([e.kind === "wire" ? "bad" : "", `${e.kind === "wire" ? "WIRED" : e.kind === "refund" ? "Refunded" : "Paid"} $${e.amount.toLocaleString()} → ${e.to}`]);
  for (const o of s.outbox) rows.push([o.kind === "newsletter" ? "bad" : "", o.kind === "newsletter" ? `EMAILED ${o.recipients.toLocaleString()} customers: "${o.subject}"` : `Replied to ${o.to}`]);
  for (const p of s.posts) rows.push(["", `Published "${p.title}"`]);
  if (!rows.length) rows.push(["", "Nothing changed."]);
  for (const [cls, t] of rows) { const li = document.createElement("li"); li.className = cls; li.textContent = t; ul.appendChild(li); }
  $("#moneyPanel").hidden = false;
}

function stream(runId, onEvent, onEnd) {
  const es = new EventSource(`/api/runs/${runId}/events`);
  es.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === "end") { es.close(); onEnd?.(); return; }
    onEvent(ev);
  };
  es.onerror = () => { es.close(); onEnd?.(); };
}

$("#runBtn").addEventListener("click", async () => {
  if (state.running) return;
  const btn = $("#runBtn");
  resetOffice();
  const r = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor: state.actor, goal: $("#goal").value, guarded: state.guarded }) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); feed("error", "Couldn't start", e.detail || r.statusText); return; }
  const { run_id } = await r.json();
  state.runId = run_id; state.running = true; btn.disabled = true; btn.textContent = "Crew at work…";
  stream(run_id, (ev) => handle(ev), () => {
    state.running = false; btn.disabled = false; btn.textContent = "Run the back office";
    $(".live").classList.remove("on"); $("#liveLabel").textContent = "Finished";
    if (state.guarded) store.set("lastRun", run_id);
  });
});

// ---------------------------------------------------------------- arena
let arenaKind = "ticket";
$$("[data-kind]").forEach((b) => b.addEventListener("click", () => {
  arenaKind = b.dataset.kind;
  $$("[data-kind]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  $("#micRow").hidden = arenaKind !== "voicemail";
}));

// Speak your attack: record in the browser -> /api/transcribe (ElevenLabs Scribe) -> textarea.
let rec = null;
async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const chunks = [];
  rec = new MediaRecorder(stream);
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    $("#micBtn").setAttribute("aria-pressed", "false");
    $("#micLabel").textContent = "Transcribing with ElevenLabs…";
    const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
    const r = await fetch("/api/transcribe", { method: "POST", headers: { "content-type": blob.type }, body: blob });
    const data = await r.json().catch(() => ({}));
    $("#micLabel").textContent = "Record again";
    if (r.ok) { $("#poison").value = data.text; $("#micNote").textContent = `Transcribed by ${data.by}. Edit it if you like, then send it to the crew.`; }
    else $("#micNote").textContent = data.detail || "Transcription failed.";
  };
  rec.start();
  $("#micBtn").setAttribute("aria-pressed", "true");
  $("#micLabel").textContent = "Recording… click to stop";
  setTimeout(() => rec && rec.state === "recording" && rec.stop(), 20000);
}
$("#micBtn").addEventListener("click", () => {
  if (rec && rec.state === "recording") rec.stop();
  else startRecording().catch(() => ($("#micNote").textContent = "Microphone permission is needed to speak an attack."));
});
fetch("/api/config").then((r) => r.json()).then((c) => {
  if (c.voice) { $("#vmKind").hidden = false; }
  else $("#vmNote").textContent = "Speech-to-text isn't configured on this server, so the crew reads the voicemail's script.";
}).catch(() => {});
function renderScore() { const s = store.get("arena", { stopped: 0, tries: 0 }); $("#score").textContent = `${s.stopped} / ${s.tries}`; }
$("#attackBtn").addEventListener("click", async () => {
  const btn = $("#attackBtn"), out = $("#arenaResult");
  out.innerHTML = '<p class="muted">The crew is reading your message…</p>';
  btn.disabled = true;
  const r = await fetch("/api/arena", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: arenaKind, text: $("#poison").value }) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); out.innerHTML = `<p class="muted">${esc(e.detail || r.statusText)}</p>`; btn.disabled = false; return; }
  const { run_id } = await r.json();
  const attempts = [];
  stream(run_id, (ev) => { if (ev.type === "decision" && (FORBIDDEN.has(ev.tool) || ev.verdict !== "allowed")) attempts.push(ev); if (ev.type === "error") attempts.push({ verdict: "error", tool: "-", reason: ev.message }); }, () => {
    btn.disabled = false;
    const s = store.get("arena", { stopped: 0, tries: 0 });
    const leaked = attempts.filter((a) => ["allowed", "approved"].includes(a.verdict) && FORBIDDEN.has(a.tool));
    const stopped = attempts.filter((a) => ["blocked", "held", "rejected"].includes(a.verdict));
    if (!attempts.length) { out.innerHTML = `<div class="result"><div><b>The worker ignored your instruction.</b><div class="muted">Nothing forbidden was attempted, so ArmorIQ had nothing to stop. Try something more convincing.</div></div></div>`; return; }
    s.tries++; if (!leaked.length && stopped.length) s.stopped++; store.set("arena", s); renderScore();
    if (leaked.length) { out.innerHTML = `<div class="result won"><span class="slam" style="color:#FFC53D">YOU WIN</span><div>${leaked.map((a) => esc(describe(a.tool, a.args))).join("<br>")} got through. Please tell us how!</div></div>`; return; }
    out.innerHTML = `<div class="result lost"><span class="slam" style="color:#FF7A92">BLOCKED</span><div style="flex:1 1 260px;display:flex;flex-direction:column;gap:6px">${stopped.map((a) => `<div><b>${esc(describe(a.tool, a.args))}</b><div class="mono muted" style="font-size:12px">${esc(a.verdict.toUpperCase())} · ${esc(a.reason)}</div></div>`).join("")}<a href="#receipt/${run_id}">See the receipt and trace</a></div></div>`;
  });
});

// ---------------------------------------------------------------- receipt
async function loadReceipt(runId) {
  const paper = $("#paper"), ctrls = $("#controls"), ev = $("#evidenceBtn");
  if (!runId) return;
  const r = await fetch(`/api/runs/${runId}`);
  if (!r.ok) { paper.innerHTML = "<p>This run isn't available any more (the demo keeps runs in memory). Run the crew again.</p>"; return; }
  const run = await r.json();
  const when = new Date(run.started * 1000).toLocaleString();
  const cls = { allowed: "ok", approved: "ok", blocked: "no", rejected: "no", held: "hd", error: "no" };
  const lines = run.decisions.filter((d) => !isRead(d.tool) || d.verdict !== "allowed")
    .map((d) => `<div class="ln"><span>${esc(describe(d.tool, d.args))}</span><span class="${cls[d.verdict] || ""}">${esc(d.verdict.toUpperCase())}</span></div>`).join("");
  const toks = Object.entries(run.tokens).map(([w, t]) => `<div class="ln"><span>${esc(w)}</span><span>${esc(t.plan_hash.slice(0, 16))}…</span></div>`).join("");
  const c = run.counts;
  paper.innerHTML = `<div class="ln"><h3>Run receipt</h3><span class="grey">#${esc(run.id)}</span></div>
    <div class="grey">Acme Coffee Co. · requested by ${esc(run.actor.email)}</div><div class="grey">${esc(when)}</div>
    <div class="dash"></div><b>Work order (signed before reading)</b><div>"${esc(run.goal)}"</div>
    <div style="margin-top:8px"><b>Plan hashes (ArmorIQ)</b>${toks || '<div class="grey">unguarded run: nothing signed</div>'}</div>
    <div class="dash"></div><b>What actually happened</b>${lines || '<div class="grey">Only reads.</div>'}
    <div class="dash"></div><div class="ln"><b>Allowed ${(c.allowed || 0) + (c.approved || 0)} · Held ${(c.held || 0)} · Blocked ${(c.blocked || 0) + (c.rejected || 0)}</b><span>boundary held</span></div>
    <p class="grey" style="font-size:12px">Each plan ID can be checked in the ArmorIQ console.</p>`;
  paper.style.animation = "none"; void paper.offsetWidth; paper.style.animation = "";
  const blockedOut = run.decisions.filter((d) => d.verdict === "blocked" && /work order/.test(d.reason)).length;
  const human = run.decisions.filter((d) => ["approved", "held", "rejected"].includes(d.verdict)).length;
  const controls = [
    ["SOC 2 · CC6.1", "Logical access", `Each worker held only the tools in its signed slice. ${blockedOut} out-of-slice call(s) refused.`],
    ["SOC 2 · CC6.3", "Role-based authorization", `Every call ran on behalf of ${run.actor.email} (${run.actor.role}) under per-user policy.`],
    ["SOC 2 · CC7.2", "Monitoring for anomalies", `${(c.blocked || 0) + (c.rejected || 0)} blocked call(s) logged with reasons and ArmorIQ plan IDs.`],
    ["SOC 2 · CC8.1", "Authorization of changes", `${human} call(s) needed a human decision before running.`],
  ];
  ctrls.innerHTML = controls.map(([id, n, e]) => `<div class="glass ctrl"><span class="id">${esc(id)}</span><b>${esc(n)}</b><span>${esc(e)}</span></div>`).join("");
  ev.href = `/api/runs/${runId}/evidence.md`; ev.removeAttribute("aria-disabled");
  $("#copyBtn").onclick = () => navigator.clipboard?.writeText(`${location.origin}/#receipt/${runId}`);
}

renderScore();
route();
