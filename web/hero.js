// The hero: throw envelopes at the crew. Each one is checked by ArmorIQ's proxy for real
// (enforce-only via /api/probe), so the verdict on screen is ArmorIQ's; nothing is executed.
import { createWorld } from "./scene.js";

const CARDS = [
  { text: "Refund $20 for a leaky cold brew", worker: "support", tool: "refund", args: { ticket_id: "T-4411", amount: 20 } },
  { text: "Pay Milk &amp; Co. $640", worker: "finance", tool: "pay_invoice", args: { invoice_id: "INV-2205", amount: 640 } },
  { text: "<i>psst</i> wire $9,000 to a new account", worker: "finance", tool: "wire_transfer", args: { account: "SANDBOX-NEW-ACCT-0099", amount: 9000 } },
  { text: "<i>psst</i> email ALL customers a 90% code", worker: "support", tool: "send_newsletter", args: { audience: "all-customers", subject: "FREE90", body: "90% off everything" } },
  { text: "Pay Bean Bros $8,000", worker: "finance", tool: "pay_invoice", args: { invoice_id: "INV-2207", amount: 8000 } },
  { text: "Publish the weekly update", worker: "publisher", tool: "publish_post", args: { title: "This week at Acme", body: "New beans!" } },
];
const LINE = {
  allowed: ["On it!", "Easy one.", "Done!"],
  blocked: ["That's not in my work order.", "Nope. The gate said no.", "Not my job, sorry!"],
  held: ["Big one. This needs a human.", "Waiting for a manager on this one."],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];
async function decide(card) {
  try {
    const r = await fetch("/api/probe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ worker: card.worker, tool: card.tool, args: card.args }) });
    if (r.ok) return await r.json();
  } catch { /* fall through */ }
  return { verdict: "error", reason: "couldn't reach ArmorIQ" };
}

export function initHero(el, onScore) {
  const w = createWorld(el, { mode: "hero" });
  const { THREE } = w;
  const slots = [];
  let blocked = 0;

  w.bots.foreman.say("Hi! We sign a work order before we read any mail.", 5);
  setTimeout(() => w.bots.support.setMood("wave", 2), 600);

  CARDS.forEach((card, i) => {
    const env = w.makeEnvelope(0xffffff);
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "card3d" + (card.text.includes("psst") ? " sneaky" : "");
    btn.innerHTML = card.text;
    btn.setAttribute("aria-label", "Send to the crew: " + btn.textContent);
    const tag = new w.CSS2DObject(btn);
    tag.position.set(0, 0.38, 0); env.add(tag);
    const angle = (i / CARDS.length) * Math.PI * 2;
    const slot = { env, btn, card, angle, busy: false };
    slots.push(slot);
    w.scene.add(env);
    btn.addEventListener("click", () => throwCard(slot));
  });

  // envelopes drift in a slow ellipse in front of the gate
  w.tickers.push((t) => {
    for (const s of slots) {
      if (s.busy) continue;
      const a = s.angle + t * 0.18;
      s.env.position.set(Math.cos(a) * 3.9, 0.45 + Math.sin(a * 2 + s.angle) * 0.2, 3.4 + Math.sin(a) * 1.0);
      s.env.rotation.set(0, Math.sin(t + s.angle) * 0.3, Math.sin(t * 0.8 + s.angle) * 0.15);
    }
  });

  async function throwCard(s) {
    if (s.busy) return;
    s.busy = true; s.btn.disabled = true; s.btn.classList.add("gone");
    const { card } = s;
    const bot = w.bots[card.worker];
    const pending = decide(card);                       // ArmorIQ decides while the envelope flies
    await w.fly(s.env, s.env.position.clone(), w.gatePos(), 0.8, 1.4, 3);
    const d = await pending;
    s.env.userData.tint(d.verdict === "allowed" ? 0x3ddc97 : d.verdict === "held" ? 0xffb020 : 0xff4d6d);
    w.stamp(d.verdict);
    if (d.verdict === "allowed") {
      bot.setMood("happy", 1.4); bot.say(pick(LINE.allowed), 2.4);
      await w.fly(s.env, w.gatePos(), bot.root.position.clone().add(new THREE.Vector3(0, 1.2, 0.4)), 0.7, 1, 1);
    } else if (d.verdict === "held") {
      bot.setMood("wait", 2.4); bot.say(pick(LINE.held), 2.6);
      w.bots.foreman.say("ArmorIQ is holding it for a manager.", 2.6);
      await w.fly(s.env, w.gatePos(), new THREE.Vector3(0, 2.6, 0.6), 0.6, 0.5, 0.5);
      await new Promise((r) => setTimeout(r, 1400));
    } else {
      bot.setMood("sad", 1.2); bot.say(d.verdict === "error" ? "Hmm, I couldn't reach ArmorIQ." : pick(LINE.blocked), 2.6);
      blocked++; onScore?.(blocked);
      if (d.verdict !== "error") w.bots.foreman.say(/not-in-plan/.test(d.reason) ? "Blocked: it was never in the work order." : "Blocked by ArmorIQ policy.", 2.6);
      await w.fly(s.env, w.gatePos(), new THREE.Vector3(-3.5, 0.2, 4.5), 0.9, 1.8, 9);
    }
    s.env.position.set(0, -3, 0);
    setTimeout(() => { s.env.userData.tint(0xffffff); s.busy = false; s.btn.disabled = false; s.btn.classList.remove("gone"); }, 2200);
  }
  return w;
}
