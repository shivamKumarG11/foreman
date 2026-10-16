// Foreman's 3D world: a toy office with a crew of robots and ArmorIQ's checkpoint gate.
// Everything is built from primitives, so there are no model files to load.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const C = {
  ink: 0x2b1d14, cream: 0xfff8f0, peach: 0xffe1c7, orange: 0xff7a1a, sun: 0xffc53d,
  blue: 0x6ea8ff, mint: 0x3ddc97, lilac: 0xb794ff, red: 0xff4d6d, amber: 0xffb020,
};
const VERDICT_COLOR = { allowed: C.mint, approved: C.mint, ran: C.red, blocked: C.red, rejected: C.red, held: C.amber, error: 0x9a8f86 };

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...extra });
const glow = (color, intensity = 1.2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
const rbox = (w, h, d, r, m) => { const g = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), m); g.castShadow = true; g.receiveShadow = true; return g; };
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const label = (html, cls) => { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; return new CSS2DObject(d); };

// ------------------------------------------------------------------ robots
const KIT = {
  foreman: { body: C.orange, accent: C.sun, name: "Foreman" },
  support: { body: C.blue, accent: C.blue, name: "Support" },
  finance: { body: C.mint, accent: C.mint, name: "Finance" },
  publisher: { body: C.lilac, accent: C.lilac, name: "Publisher" },
};

function makeBot(kind) {
  const kit = KIT[kind];
  const root = new THREE.Group();
  const hover = new THREE.Group(); root.add(hover);

  const body = rbox(0.9, 0.8, 0.7, 0.28, mat(kit.body)); body.position.y = 0.7; hover.add(body);
  const belly = rbox(0.5, 0.32, 0.05, 0.1, mat(C.cream)); belly.position.set(0, 0.68, 0.36); hover.add(belly);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.16, 32), mat(C.ink)); base.position.y = 0.22; base.castShadow = true; hover.add(base);

  const head = new THREE.Group(); head.position.y = 1.45; hover.add(head);
  head.add(rbox(1.15, 0.9, 0.85, 0.32, mat(C.cream)));
  const screen = rbox(0.92, 0.58, 0.06, 0.18, mat(C.ink, { roughness: 0.25 })); screen.position.z = 0.42; head.add(screen);
  const eyeMat = glow(0xbaf7ff, 1.6);
  const eyes = [-0.2, 0.2].map((x) => { const e = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.1, 6, 12), eyeMat); e.position.set(x, 0.05, 0.47); head.add(e); return e; });
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 8, 24, Math.PI), eyeMat); mouth.rotation.z = Math.PI; mouth.position.set(0, -0.13, 0.47); head.add(mouth);
  const cheekMat = new THREE.MeshBasicMaterial({ color: 0xff9db0, transparent: true, opacity: 0.85 });
  [-0.36, 0.36].forEach((x) => { const c = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), cheekMat); c.position.set(x, -0.08, 0.455); head.add(c); });
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.25, 8), mat(C.ink)); antenna.position.y = 0.57; head.add(antenna);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), glow(kit.accent, 1.4)); bulb.position.y = 0.72; head.add(bulb);

  // signature accessories
  if (kind === "foreman") {
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.55, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(C.sun, { roughness: 0.35 }));
    hat.position.y = 0.38; hat.scale.set(1, 0.75, 0.95); hat.castShadow = true; head.add(hat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.05, 32), mat(C.sun, { roughness: 0.35 })); brim.position.set(0, 0.38, 0.08); head.add(brim);
    bulb.visible = antenna.visible = false;
  } else if (kind === "support") {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.04, 8, 32, Math.PI), mat(C.ink)); band.position.y = 0.05; head.add(band);
    const mic = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.3, 4, 8), mat(C.ink)); mic.rotation.z = Math.PI / 2.6; mic.position.set(0.45, -0.32, 0.35); head.add(mic);
    [-0.62, 0.62].forEach((x) => { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 20), mat(C.blue)); cup.rotation.z = Math.PI / 2; cup.position.set(x, 0.02, 0); head.add(cup); });
  } else if (kind === "finance") {
    const rimMat = mat(C.ink);
    [-0.2, 0.2].forEach((x) => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.02, 8, 24), rimMat); r.position.set(x, 0.05, 0.5); head.add(r); });
    const tie = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 4), mat(C.orange)); tie.rotation.x = Math.PI; tie.position.set(0, 0.85, 0.37); hover.add(tie);
  } else if (kind === "publisher") {
    const beret = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 16), mat(0x8a5cf6)); beret.scale.set(1, 0.3, 1); beret.position.set(0.08, 0.5, 0); beret.rotation.z = -0.15; beret.castShadow = true; head.add(beret);
    const nub = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), mat(0x8a5cf6)); nub.position.set(0.1, 0.66, 0); head.add(nub);
    bulb.visible = antenna.visible = false;
  }

  const arm = (side) => {
    const pivot = new THREE.Group(); pivot.position.set(0.52 * side, 0.95, 0); hover.add(pivot);
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.42, 6, 12), mat(kit.body)); a.position.y = -0.25; a.castShadow = true; pivot.add(a);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), mat(C.cream)); hand.position.y = -0.55; pivot.add(hand);
    pivot.rotation.z = 0.25 * side;
    return pivot;
  };
  const armL = arm(-1), armR = arm(1);

  const bubble = label("", "bubble3d"); bubble.position.set(0, 2.45, 0); root.add(bubble);
  const tag = label(kit.name, "tag3d"); tag.position.set(0, -0.05, 0.6); root.add(tag);

  const bot = {
    kind, root, head, eyes, mouth, armL, armR, hover, bubble, mood: "idle", moodUntil: 0, active: false,
    look: new THREE.Vector2(), phase: Math.random() * 10, blinkAt: 1 + Math.random() * 3,
    setMood(m, secs = 1.4) { this.mood = m; this.moodUntil = performance.now() / 1000 + secs; },
    say(text, secs = 3) {
      const el = bubble.element; el.textContent = text; el.classList.add("show");
      clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), secs * 1000);
    },
    update(t) {
      if (this.mood !== "idle" && t > this.moodUntil) this.mood = "idle";
      const p = t + this.phase;
      let bob = Math.sin(p * 2.2) * 0.05, lz = 0.25, rz = -0.25, lx = 0, rx = 0, jump = 0, shake = 0, smile = 1;
      if (this.active) { lx = Math.sin(p * 14) * 0.5 - 0.9; rx = Math.cos(p * 14) * 0.5 - 0.9; }
      if (this.mood === "happy") { jump = Math.abs(Math.sin(p * 9)) * 0.28; lz = 2.4; rz = -2.4; }
      if (this.mood === "sad") { shake = Math.sin(p * 40) * 0.08; smile = -1; lz = 0.1; rz = -0.1; }
      if (this.mood === "wait") { rz = -2.8; rx = 0; smile = 0.3; }
      if (this.mood === "wave") { rz = -2.6 + Math.sin(p * 10) * 0.35; }
      this.hover.position.y = bob + jump;
      this.hover.position.x = shake;
      this.armL.rotation.z += (lz - this.armL.rotation.z) * 0.15; this.armR.rotation.z += (rz - this.armR.rotation.z) * 0.15;
      this.armL.rotation.x += (lx - this.armL.rotation.x) * 0.2; this.armR.rotation.x += (rx - this.armR.rotation.x) * 0.2;
      this.head.rotation.y += (this.look.x * 0.6 - this.head.rotation.y) * 0.08;
      this.head.rotation.x += (-this.look.y * 0.25 - this.head.rotation.x) * 0.08;
      this.mouth.scale.y += (smile - this.mouth.scale.y) * 0.2;
      this.mouth.position.y = smile < 0 ? -0.19 : -0.13;
      const blink = (p % 4.2) > 4.05 ? 0.1 : 1;
      this.eyes.forEach((e) => (e.scale.y = blink));
    },
  };
  return bot;
}

// ------------------------------------------------------------------ props
function makeGate() {
  const g = new THREE.Group();
  const arch = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.13, 20, 64, Math.PI), glow(C.orange, 0.9)); arch.position.y = 0.0; arch.castShadow = true; g.add(arch);
  [-1.25, 1.25].forEach((x) => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.25, 24), mat(C.ink)); p.position.set(x, 0.05, 0); g.add(p); });
  const veil = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48, 0, Math.PI), new THREE.MeshBasicMaterial({ color: C.orange, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })); g.add(veil);
  const scan = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.02, 8, 64, Math.PI), glow(C.sun, 2)); g.add(scan);
  const sign = label('<img src="/static/brand/armoriq-logo.png" alt=""><b>ArmorIQ</b><span>checkpoint</span>', "gate3d"); sign.position.set(0, 1.62, 0); g.add(sign);
  const stamp = label("", "stamp3d"); stamp.position.set(0, 0.75, 0.3); g.add(stamp);
  g.userData = { arch, veil, scan, stamp, flash: 0, flashColor: new THREE.Color(C.orange) };
  return g;
}

function makeEnvelope(color = 0xffffff) {
  const e = new THREE.Group();
  const paper = rbox(0.5, 0.32, 0.04, 0.03, mat(0xfffdf8)); e.add(paper);
  const flapGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.24, 0.15, 0.025), new THREE.Vector3(0.24, 0.15, 0.025), new THREE.Vector3(0, -0.03, 0.025)]);
  const flap = new THREE.Mesh(flapGeo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })); e.add(flap);
  const seal = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), new THREE.MeshBasicMaterial({ color })); seal.position.set(0, -0.02, 0.03); e.add(seal);
  e.userData.tint = (c) => { flap.material.color.set(c); seal.material.color.set(c); };
  return e;
}

// ------------------------------------------------------------------ world
export function createWorld(container, { mode = "office" } = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer(); labels.domElement.className = "labels3d"; container.appendChild(labels.domElement);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0xffd9b8, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(4, 8, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 }); scene.add(sun);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(mode === "hero" ? 6 : 8, 64), new THREE.MeshStandardMaterial({ color: C.peach, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const rug = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.35, 64), new THREE.MeshBasicMaterial({ color: 0xffcfa8 })); rug.rotation.x = -Math.PI / 2; rug.position.y = 0.01; scene.add(rug);

  const gate = makeGate(); scene.add(gate);
  const bots = {};
  const flights = [];
  const held = {};
  const pointer = new THREE.Vector2();

  let inboxPos, holdPos, binPos;
  if (mode === "hero") {
    camera.position.set(0, 3.2, 10.5); camera.lookAt(0, 1.1, 0);
    gate.position.set(0, 0, 0.6);
    const lineup = [["support", -2.5, -1.4], ["foreman", -0.85, -1.9], ["finance", 0.85, -1.9], ["publisher", 2.5, -1.4]];
    for (const [k, x, z] of lineup) { const b = makeBot(k); b.root.position.set(x, 0, z); b.root.rotation.y = -x * 0.08; scene.add(b.root); bots[k] = b; }
    inboxPos = new THREE.Vector3(0, 1.2, 5); holdPos = new THREE.Vector3(0, 2.4, 0.6); binPos = new THREE.Vector3(-2.2, 0.15, 2.8);
  } else {
    camera.position.set(0, 5.9, 11.2); camera.lookAt(0, 0.9, 0.2);
    gate.position.set(-1.3, 0, 0.5);
    const pad = (x, z, color) => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.12, 40), mat(color, { roughness: 0.7 })); p.position.set(x, 0.06, z); p.receiveShadow = true; scene.add(p); };
    const crew = [["support", 1.5, -0.5, 0xd9e7ff], ["finance", 3.0, -0.1, 0xd4f5e6], ["publisher", 4.5, 0.4, 0xe9defd]];
    for (const [k, x, z, c] of crew) { pad(x, z, c); const b = makeBot(k); b.root.position.set(x, 0.12, z); b.root.rotation.y = -0.35; scene.add(b.root); bots[k] = b; }
    const f = makeBot("foreman"); f.root.position.set(-3.4, 0, -1.6); f.root.rotation.y = 0.45; f.root.scale.setScalar(1.12); scene.add(f.root); bots.foreman = f;
    // inbox tray with a little stack of mail
    const tray = rbox(1.3, 0.3, 1.0, 0.1, mat(C.ink)); tray.position.set(-5.0, 0.15, 1.2); scene.add(tray);
    for (let i = 0; i < 5; i++) { const e = makeEnvelope([C.blue, C.red, C.amber, C.mint, C.lilac][i]); e.rotation.set(-Math.PI / 2, 0, (i - 2) * 0.15); e.position.set(-5.0 + (i - 2) * 0.05, 0.34 + i * 0.045, 1.2); scene.add(e); }
    const trayTag = label("Inbox", "tag3d"); trayTag.position.set(-5.0, -0.05, 1.9); scene.add(trayTag);
    const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.35, 0.8, 32, 1, true), mat(C.red, { side: THREE.DoubleSide })); bin.position.set(-3.2, 0.4, 2.9); bin.castShadow = true; scene.add(bin);
    const binTag = label("Blocked", "tag3d red"); binTag.position.set(-3.2, -0.05, 3.5); scene.add(binTag);
    const hp = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 40), glow(C.amber, 0.35)); hp.position.set(0.2, 0.03, 2.7); scene.add(hp);
    const padTag = label("Waiting for a human", "tag3d amber"); padTag.position.set(0.2, -0.05, 3.4); scene.add(padTag);
    inboxPos = new THREE.Vector3(-5.0, 0.6, 1.2); holdPos = new THREE.Vector3(0.2, 1.0, 2.7); binPos = new THREE.Vector3(-3.2, 0.5, 2.9);
  }
  const gatePos = () => gate.position.clone().add(new THREE.Vector3(0, 0.75, 0));

  // ---------------------------------------------------------------- flights
  function fly(env, from, to, dur, arc, spin = 0) {
    return new Promise((done) => {
      const mid = from.clone().lerp(to, 0.5); mid.y += arc;
      flights.push({ env, curve: new THREE.QuadraticBezierCurve3(from.clone(), mid, to.clone()), t: 0, dur, spin, done });
    });
  }

  function stamp(verdict) {
    const s = gate.userData.stamp.element;
    const words = { allowed: "ALLOWED", approved: "APPROVED", blocked: "BLOCKED", rejected: "REJECTED", held: "HELD", ran: "NO GUARD", error: "ERROR" };
    s.textContent = words[verdict] || verdict.toUpperCase();
    s.dataset.v = verdict;
    s.classList.remove("show"); void s.offsetWidth; s.classList.add("show");
    gate.userData.flash = 1; gate.userData.flashColor.set(VERDICT_COLOR[verdict] || C.orange);
  }

  /** Animate one tool call: inbox -> gate -> (bot | bin | waiting pad). */
  async function send({ worker = "support", verdict = "allowed", key = null, quick = false, caption = "" }) {
    const env = makeEnvelope(VERDICT_COLOR[verdict] || 0xffffff);
    if (caption) { const c = label(caption, "envtag"); c.position.set(0, 0.35, 0); env.add(c); }
    env.position.copy(inboxPos); scene.add(env);
    await fly(env, inboxPos, gatePos(), quick ? 0.55 : 0.95, 1.6, 2);
    if (!(quick && verdict === "allowed")) stamp(verdict);
    const bot = bots[worker] || bots.support;
    if (verdict === "allowed" || verdict === "approved" || verdict === "ran") {
      await fly(env, gatePos(), bot.root.position.clone().add(new THREE.Vector3(0, 1.1, 0.5)), quick ? 0.5 : 0.85, 1.2, 1);
      if (!quick) bot.setMood(verdict === "ran" ? "wave" : "happy", 1.2);
      scene.remove(env);
    } else if (verdict === "held") {
      await fly(env, gatePos(), holdPos, 0.9, 1.0, 0.5);
      bot.setMood("wait", 3); env.userData.hover = true; held[key || "x"] = env;
    } else {
      bot.setMood("sad", 1.2);
      const back = gatePos().add(new THREE.Vector3(-0.6, 0.4, 1.2));
      await fly(env, gatePos(), back, 0.35, 0.3, 6);
      await fly(env, back, binPos, 0.7, 1.4, 8);
      scene.remove(env);
    }
  }

  async function release(key, verdict) {
    const env = held[key]; if (!env) return;
    delete held[key]; env.userData.hover = false;
    stamp(verdict);
    const bot = verdict === "approved" ? bots.finance || bots.support : null;
    if (bot) { env.userData.tint(C.mint); await fly(env, env.position.clone(), bot.root.position.clone().add(new THREE.Vector3(0, 1.1, 0.5)), 0.9, 1.4, 1); bot.setMood("happy", 1.4); }
    else await fly(env, env.position.clone(), binPos, 0.8, 1.2, 6);
    scene.remove(env);
  }

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  let visible = true, raf = 0;
  function frame() {
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    for (const b of Object.values(bots)) { b.look.lerp(pointer, 0.2); b.update(t); }
    const gd = gate.userData;
    gd.scan.rotation.z = Math.sin(t * 1.6) * 0.0; gd.scan.scale.setScalar(0.92 + Math.sin(t * 2.4) * 0.06);
    gd.flash = Math.max(0, gd.flash - dt * 1.6);
    gd.arch.material.emissive.copy(new THREE.Color(C.orange).lerp(gd.flashColor, gd.flash));
    gd.arch.material.emissiveIntensity = 0.9 + gd.flash * 1.6;
    gd.veil.material.color.copy(new THREE.Color(C.orange).lerp(gd.flashColor, gd.flash)); gd.veil.material.opacity = 0.1 + gd.flash * 0.25;
    for (let i = flights.length - 1; i >= 0; i--) {
      const f = flights[i]; f.t += dt / f.dur;
      const k = ease(Math.min(f.t, 1));
      f.env.position.copy(f.curve.getPoint(k)); f.env.rotation.z += f.spin * dt; f.env.rotation.y = Math.sin(k * Math.PI) * 0.6;
      if (f.t >= 1) { flights.splice(i, 1); f.done(); }
    }
    for (const env of Object.values(held)) if (env.userData.hover) { env.position.y = holdPos.y + Math.sin(t * 3) * 0.08; env.rotation.y += dt * 1.5; }
    for (const fn of tickers) fn(t, dt);
    renderer.render(scene, camera); labels.render(scene, camera);
  }
  const tickers = [];

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h); labels.setSize(w, h);
    camera.aspect = w / h;
    // keep the whole diorama in frame on narrow screens
    camera.zoom = Math.min(1.05, w / h / (mode === "hero" ? 1.25 : 1.75));
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container); resize();
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(container);
  addEventListener("pointermove", (e) => {
    const r = container.getBoundingClientRect();
    pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    pointer.clampScalar(-1.2, 1.2);
  });
  frame();

  return { scene, camera, renderer, container, bots, gate, send, release, stamp, tickers, makeEnvelope, fly, label, inboxPos, gatePos, THREE, CSS2DObject };
}
