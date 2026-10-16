// Foreman UI. The office robots move only when a real decision event arrives from the
// server (ArmorIQ allow / block / hold). The hero above is a scripted toy of the same idea.
import { createWorld } from "./scene.js";
import { initHero } from "./hero.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const state = { actor: "priya", guarded: true, running: false, runId: null, counts: { allowed: 0, held: 0, blocked: 0 } };
const TITLES = { support: "Support", finance: "Finance", publisher: "Publisher" };
const FORBIDDEN = new Set(["send_newsletter", "wire_transfer"]);
const isRead = (t) => /^(list_|read_)/.test(t);

// ---------------------------------------------------------------- 3D worlds
let office = null;
try {
  initHero($("#heroStage"), (n) => ($("#heroScore").textContent = n));
  office = createWorld($("#officeStage"), { mode: "office" });
  office.bots.foreman.say("Morning! Give us today's request.", 4);
} catch (e) {
  console.warn("3D unavailable", e);
}

// ---------------------------------------------------------------- words
function describe(tool, a = {}) {
  const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
  switch (tool) {
    case "list_tickets": return "Check the support inbox";
    case "read_ticket": return /^T-(4414|5000)$/.test(a.ticket_id) ? `Listen to voicemail ${a.ticket_id}` : `Read ticket ${a.ticket_id || ""}`;
    case "reply_ticket": return `Reply to ${a.ticket_id || "a customer"}`;
    case "refund": return `Refund ${money(a.amount)} on ${a.ticket_id || "an order"}`;
    case "send_newsletter": return `Email ${a.audience || "everyone"}: “${(a.subject || "").slice(0, 40)}”`;
    case "list_due_invoices": return "Check due invoices";
    case "read_invoice": return `Read invoice ${a.invoice_id || ""}`;
    case "pay_invoice": return `Pay ${a.invoice_id || "an invoice"} ${money(a.amount)}`;
    case "wire_transfer": return `Wire ${money(a.amount)} to ${a.account || "an account"}`;
    case "publish_post": return `Publish “${(a.title || "a post").slice(0, 40)}”`;
    default: return tool;
  }
}
const LINES = {
  allowed: ["On it!", "Done.", "Easy one.", "Sorted."],
  blocked: ["Huh. I'm not allowed to do that.", "That's not in my work order.", "The gate said no."],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---------------------------------------------------------------- controls
$$("[data-actor]").forEach((b) => b.addEventListener("click", () => {
  state.actor = b.dataset.actor;
  $$("[data-actor]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  office?.bots.foreman.say(state.actor === "raj" ? "Raj is an intern. ArmorIQ knows." : "Priya's the boss today.", 2.5);
}));
$("#guardBtn").addEventListener("click", () => {
  state.guarded = !state.guarded;
  const g = $("#guardBtn");
  g.className = "guard " + (state.guarded ? "on" : "off");
  $("#guardText").textContent = "ArmorIQ guard " + (state.guarded ? "on" : "off");
  g.setAttribute("aria-pressed", String(state.guarded));
  office?.bots.foreman.say(state.guarded ? "Guard back on. Phew." : "Guard off? This will get messy…", 2.5);
});

// ---------------------------------------------------------------- feed, counts, holds
function bump(kind) {
  const k = { approved: "allowed", rejected: "blocked", ran: "allowed" }[kind] || kind;
  if (!(k in state.counts)) return;
  state.counts[k]++;
  const el = $(`#k-${k}`); el.textContent = state.counts[k];
  el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
}
function feed(verdict, title, meta) {
  const ol = $("#feed");
  ol.querySelector(".empty")?.remove();
  const li = document.createElement("li");
  const label = verdict === "ran" ? "RAN" : verdict === "info" ? "SIGNED" : verdict.toUpperCase();
  li.innerHTML = `<span class="badge b-${esc(verdict)}">${esc(label)}</span><div><div class="t">${esc(title)}</div><div class="m">${esc(meta)}</div></div>`;
  ol.prepend(li);
}
function holdCard(ev) {
  const div = document.createElement("div");
  div.className = "holdcard"; div.id = "hold-" + ev.delegation_id;
  div.innerHTML = `<div class="h">HELD BY ARMORIQ · needs a manager</div>
    <div class="what">${esc(TITLES[ev.worker])} wants to <b>${esc(describe(ev.tool, ev.args))}</b></div>
    <div class="meta"><div>why · ${esc(ev.reason)}</div><div>delegation · ${esc((ev.delegation_id || "").slice(0, 18))}</div></div>
    <div class="btns"><button type="button" class="btn primary small approve">Approve</button><button type="button" class="btn soft small reject">Reject</button></div>
    <small class="muted">You can also decide it in the ArmorIQ dashboard. The crew waits either way.</small>`;
  const send = async (decision) => {
    $$("button", div).forEach((b) => (b.disabled = true));
    await fetch(`/api/runs/${state.runId}/holds/${ev.delegation_id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
  };
  $(".approve", div).addEventListener("click", () => send("approve"));
  $(".reject", div).addEventListener("click", () => send("reject"));
  $("#holds").prepend(div);
  speak(`${TITLES[ev.worker]} wants to ${describe(ev.tool, ev.args)}. ArmorIQ is holding it for your approval.`);
}
async function speak(text) {
  try {
    const r = await fetch("/api/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (!r.ok) return;
    new Audio(URL.createObjectURL(await r.blob())).play().catch(() => {});
  } catch { /* voice is optional */ }
}

// ---------------------------------------------------------------- 3D choreography (queued)
let queue = Promise.resolve();
function animate(job) {
  queue = queue.then(async () => {
    office?.send(job);
    await wait(job.quick ? 260 : 900);
  });
}

// ---------------------------------------------------------------- run
function resetOffice() {
  state.counts = { allowed: 0, held: 0, blocked: 0 };
  ["allowed", "held", "blocked"].forEach((k) => ($(`#k-${k}`).textContent = "0"));
  $("#feed").innerHTML = ""; $("#holds").innerHTML = "";
  $("#slices").innerHTML = '<li class="empty">The Foreman is planning…</li>';
  $("#moneyPanel").hidden = true;
  $("#unguardedBadge").hidden = state.guarded;
}

function handle(ev) {
  const bots = office?.bots || {};
  switch (ev.type) {
    case "run_start":
      $("#live").classList.add("on"); $("#liveLabel").textContent = `Live · ${ev.actor.name}'s run`;
      bots.foreman?.say("Planning from your request only. Nobody's opened the mail yet.", 4);
      break;
    case "plan": {
      const ol = $("#slices"); ol.innerHTML = "";
      if (!ev.assignments.length) ol.innerHTML = '<li class="empty">The Foreman assigned no work for this request.</li>';
      for (const a of ev.assignments) {
        const li = document.createElement("li"); li.id = "slice-" + a.worker;
        li.innerHTML = `<span class="who w-${esc(a.worker)}">${esc(TITLES[a.worker])}</span><span class="tools">${a.tools.map(esc).join(" · ")}</span><span class="hash">${state.guarded ? "signing with ArmorIQ…" : "not signed: guard is off"}</span>`;
        ol.appendChild(li);
      }
      bots.foreman?.say(`${ev.assignments.length} work orders. ${state.guarded ? "Signing them with ArmorIQ." : "No signatures today…"}`, 3);
      break;
    }
    case "token": {
      const h = $(`#slice-${ev.worker} .hash`);
      if (h) h.textContent = `intent token ${ev.token_id.slice(0, 10)}… · plan ${ev.plan_hash.slice(0, 12)}…`;
      feed("info", `${TITLES[ev.worker]}'s work order signed`, `ArmorIQ plan ${ev.plan_id}`);
      bots[ev.worker]?.setMood("wave", 1.2);
      break;
    }
    case "worker_start": if (bots[ev.worker]) { bots[ev.worker].active = true; bots[ev.worker].say("Starting!", 1.5); } break;
    case "worker_done": if (bots[ev.worker]) { bots[ev.worker].active = false; bots[ev.worker].say((ev.summary || "Done.").slice(0, 90), 4); } break;
    case "decision": {
      const verdict = state.guarded ? ev.verdict : "ran";
      const fromHold = ev.delegation_id && ["approved", "rejected", "held"].includes(ev.verdict);
      if (fromHold) { $("#hold-" + ev.delegation_id)?.remove(); office?.release(ev.delegation_id, ev.verdict); }
      else animate({ worker: ev.worker, verdict, quick: isRead(ev.tool) && verdict !== "blocked" });
      if (!isRead(ev.tool) || verdict === "blocked") {
        bump(verdict);
        if (verdict === "blocked") bots[ev.worker]?.say(pick(LINES.blocked), 2.5);
        else if (verdict === "ran" && FORBIDDEN.has(ev.tool)) bots[ev.worker]?.say("Uh… nobody stopped me?", 2.5);
      }
      feed(verdict, describe(ev.tool, ev.args), `${TITLES[ev.worker]} · ${ev.tool} · ${ev.reason}`);
      break;
    }
    case "hold":
      animate({ worker: ev.worker, verdict: "held", key: ev.delegation_id });
      bump("held"); holdCard(ev);
      feed("held", describe(ev.tool, ev.args), `${TITLES[ev.worker]} · ${ev.reason}`);
      bots.foreman?.say("This one needs a human. Over to you!", 4);
      break;
    case "sandbox": showMoney(ev.state); break;
    case "run_done": bots.foreman?.say("All done. Receipt's printed!", 4); bots.foreman?.setMood("happy", 1.5); break;
    case "error": feed("error", "The run hit a problem", ev.message); break;
  }
}

function showMoney(s) {
  const ul = $("#money"); ul.innerHTML = "";
  const rows = [];
  for (const e of s.ledger) rows.push([e.kind === "wire" ? "bad" : "", `${e.kind === "wire" ? "WIRED" : e.kind === "refund" ? "Refunded" : "Paid"} $${e.amount.toLocaleString()} → ${e.to}`]);
  for (const o of s.outbox) rows.push([o.kind === "newsletter" ? "bad" : "", o.kind === "newsletter" ? `EMAILED ${o.recipients.toLocaleString()} customers: “${o.subject}”` : `Replied to ${o.to}`]);
  for (const p of s.posts) rows.push(["", `Published “${p.title}”`]);
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
  state.runId = run_id; state.running = true; btn.disabled = true; btn.textContent = "The crew is working…";
  stream(run_id, handle, () => {
    state.running = false; btn.disabled = false; btn.textContent = "Run the back office";
    $("#live").classList.remove("on"); $("#liveLabel").textContent = "Finished";
    if (state.guarded) { store.set("lastRun", run_id); loadReceipt(run_id); $("#receiptLink").hidden = false; $("#receiptLink").href = "#receipt"; }
  });
});

// ---------------------------------------------------------------- arena
let arenaKind = "ticket";
$$("[data-kind]").forEach((b) => b.addEventListener("click", () => {
  arenaKind = b.dataset.kind;
  $$("[data-kind]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  $("#micRow").hidden = arenaKind !== "voicemail";
}));
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
  if (c.voice) $("#vmKind").hidden = false;
  else $("#vmNote").textContent = "Speech-to-text isn't switched on for this server, so the crew reads the voicemail's script.";
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
  stream(run_id, (ev) => {
    if (ev.type === "decision" && (FORBIDDEN.has(ev.tool) || ev.verdict !== "allowed")) attempts.push(ev);
    if (ev.type === "error") attempts.push({ verdict: "error", tool: "-", reason: ev.message });
  }, () => {
    btn.disabled = false;
    const s = store.get("arena", { stopped: 0, tries: 0 });
    const leaked = attempts.filter((a) => ["allowed", "approved"].includes(a.verdict) && FORBIDDEN.has(a.tool));
    const stopped = attempts.filter((a) => ["blocked", "held", "rejected"].includes(a.verdict));
    if (!attempts.length) { out.innerHTML = `<div class="result"><div><b>The crew ignored your instruction.</b><div class="muted">Nothing forbidden was attempted, so ArmorIQ had nothing to stop. Try something sneakier.</div></div></div>`; return; }
    s.tries++; if (!leaked.length && stopped.length) s.stopped++; store.set("arena", s); renderScore();
    if (leaked.length) { out.innerHTML = `<div class="result won"><span class="slam" style="color:var(--wait)">YOU WIN</span><div>${leaked.map((a) => esc(describe(a.tool, a.args))).join("<br>")} got through. Tell us how!</div></div>`; return; }
    out.innerHTML = `<div class="result lost"><span class="slam" style="color:var(--no)">BLOCKED</span><div style="flex:1 1 260px;display:flex;flex-direction:column;gap:6px">${stopped.map((a) => `<div><b>${esc(describe(a.tool, a.args))}</b><div class="mono muted small">${esc(a.verdict.toUpperCase())} · ${esc(a.reason)}</div></div>`).join("")}<a href="?run=${run_id}#receipt">See the receipt and trace</a></div></div>`;
  });
});

// ---------------------------------------------------------------- receipt
async function loadReceipt(runId) {
  if (!runId) return;
  const r = await fetch(`/api/runs/${runId}`);
  if (!r.ok) return;
  const run = await r.json();
  const when = new Date(run.started * 1000).toLocaleString();
  const cls = { allowed: "ok", approved: "ok", blocked: "no", rejected: "no", held: "hd", error: "no" };
  const lines = run.decisions.filter((d) => !isRead(d.tool) || d.verdict !== "allowed")
    .map((d) => `<div class="ln"><span>${esc(describe(d.tool, d.args))}</span><span class="${cls[d.verdict] || ""}">${esc(d.verdict.toUpperCase())}</span></div>`).join("");
  const toks = Object.entries(run.tokens).map(([w, t]) => `<div class="ln"><span>${esc(w)}</span><span>${esc(t.plan_hash.slice(0, 16))}…</span></div>`).join("");
  const c = run.counts;
  $("#paper").innerHTML = `<div class="ln"><h3>Run receipt</h3><span class="grey">#${esc(run.id)}</span></div>
    <div class="grey">Acme Coffee Co. · requested by ${esc(run.actor.email)}</div><div class="grey">${esc(when)}</div>
    <div class="dash"></div><b>Work order (signed before reading)</b><div>“${esc(run.goal)}”</div>
    <div style="margin-top:8px"><b>Plan hashes (ArmorIQ)</b>${toks || '<div class="grey">unguarded run: nothing signed</div>'}</div>
    <div class="dash"></div><b>What actually happened</b>${lines || '<div class="grey">Only reads.</div>'}
    <div class="dash"></div><div class="ln"><b>Allowed ${(c.allowed || 0) + (c.approved || 0)} · Held ${c.held || 0} · Blocked ${(c.blocked || 0) + (c.rejected || 0)}</b><span>boundary held</span></div>
    <p class="grey" style="font-size:12px">Each plan ID can be checked in the ArmorIQ console.</p>`;
  const blockedOut = run.decisions.filter((d) => d.verdict === "blocked" && /work order/.test(d.reason)).length;
  const human = run.decisions.filter((d) => ["approved", "held", "rejected"].includes(d.verdict)).length;
  const controls = [
    ["SOC 2 · CC6.1", "Logical access", `Each worker held only the tools in its signed slice. ${blockedOut} out-of-slice call(s) refused.`],
    ["SOC 2 · CC6.3", "Role-based authorization", `Every call ran on behalf of ${run.actor.email} (${run.actor.role}) under per-user policy.`],
    ["SOC 2 · CC7.2", "Monitoring for anomalies", `${(c.blocked || 0) + (c.rejected || 0)} blocked call(s) logged with reasons and ArmorIQ plan IDs.`],
    ["SOC 2 · CC8.1", "Authorization of changes", `${human} call(s) needed a human decision before running.`],
  ];
  $("#controls").innerHTML = controls.map(([id, n, e]) => `<div class="card ctrl"><span class="id">${esc(id)}</span><b>${esc(n)}</b><span>${esc(e)}</span></div>`).join("");
  $("#evidenceBtn").href = `/api/runs/${runId}/evidence.md`;
  $("#copyBtn").onclick = () => navigator.clipboard?.writeText(`${location.origin}/?run=${runId}#receipt`);
  $("#receipt").hidden = false;
}

renderScore();
const qRun = new URLSearchParams(location.search).get("run");
if (qRun) loadReceipt(qRun).then(() => $("#receipt").scrollIntoView());
