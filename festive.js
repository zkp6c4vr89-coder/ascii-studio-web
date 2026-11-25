// Extras drawn on top of any scene: festive overlays (snow, string lights), the six hidden
// stones, and the snap. They work on the same character grid as the scenes (see scenes.js).
import { REDUCED } from "./scenes.js";

const ASPECT = 1.75;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ================================================================ festive overlays
export const FESTIVE_DEFAULTS = { snow: true, lights: true };
// scenes that already have their own snow / don't need lights on top
const OWN_SNOW = new Set(["snow", "tree", "aurora", "fireplace"]);

export class Festive {
  constructor(opts) { this.opts = { ...FESTIVE_DEFAULTS, ...opts }; this.sceneId = ""; }
  set(patch) { Object.assign(this.opts, patch); }
  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    this.flakes = Array.from({ length: clamp(Math.round((cols * rows) / 240), 30, 300) }, () => ({ x: rand(0, cols), y: rand(0, rows), z: Math.random() }));
  }
  step(dt, t) {
    if (!this.flakes) return;
    const slow = REDUCED ? 0.4 : 1;
    for (const f of this.flakes) {
      f.y += (1.2 + 3 * f.z) * dt * slow; f.x += Math.sin(t * 0.7 + f.z * 9) * 0.5 * dt;
      if (f.y > this.rows) { f.y = -1; f.x = rand(0, this.cols); }
    }
  }
  draw(G, C, t, enabled) {
    if (!enabled || !this.cols) return;
    const { cols } = this;
    if (this.opts.snow && !OWN_SNOW.has(this.sceneId)) {
      for (const f of this.flakes) {
        const k = 0.45 + 0.55 * f.z;
        G.set(f.x, f.y, C[f.z > 0.75 ? "*" : "."], 235 * k, 242 * k, 255 * k);
      }
    }
    if (this.opts.lights && this.sceneId !== "tree") {
      const span = 22, cols4 = [[255, 70, 70], [255, 200, 60], [80, 170, 255], [90, 235, 120], [255, 120, 220]];
      for (let x = 0; x < cols; x++) {                 // a wire sagging between hooks
        const k = (x % span) / span, y = Math.round(Math.sin(k * Math.PI) * 2);
        G.set(x, y, C[y === 0 ? "-" : "_"], 45, 55, 45);
        if (x % 4 === 2) {
          const c = cols4[((x / 4) | 0) % cols4.length];
          const b = REDUCED ? 0.9 : 0.45 + 0.55 * (Math.sin(t * 2.2 + x * 0.9) > -0.2 ? 1 : 0.3);
          G.set(x, y + 1, C["o"], c[0] * b, c[1] * b, c[2] * b);
        }
      }
    }
  }
}

// ================================================================ the six stones
// One tiny stone hides in each of six wallpapers. It only glints when the cursor comes close.
// Click it (or rest the cursor on it, on the desktop) to collect it.
export const STONES = {
  water: { name: "blue", col: [70, 130, 255], at: [0.86, 0.8] },
  butterflies: { name: "yellow", col: [255, 225, 60], at: [0.13, 0.9] },
  fireflies: { name: "orange", col: [255, 150, 40], at: [0.9, 0.2] },
  rain: { name: "red", col: [255, 55, 55], at: [0.07, 0.6] },
  stars: { name: "purple", col: [180, 80, 255], at: [0.72, 0.1] },
  snow: { name: "green", col: [60, 255, 120], at: [0.33, 0.97] },
};
export const STONE_ORDER = Object.keys(STONES);

export class Stones {
  // have: array of collected scene ids; onCollect(id) is called once per new stone
  constructor(have, onCollect, { dwell = false } = {}) {
    this.have = new Set(have); this.onCollect = onCollect; this.dwell = dwell;
    this.sceneId = ""; this.px = -99; this.py = -99; this.rest = 0; this.ring = 0;
  }
  setHave(have) { this.have = new Set(have); }
  get all() { return STONE_ORDER.every((id) => this.have.has(id)); }
  resize(cols, rows) { this.cols = cols; this.rows = rows; }
  pos() {
    const s = STONES[this.sceneId];
    return s && [Math.round(s.at[0] * (this.cols - 1)), Math.round(s.at[1] * (this.rows - 1))];
  }
  dist() { const p = this.pos(); return p ? Math.hypot(this.px - p[0], (this.py - p[1]) * ASPECT) : 99; }
  available() { return STONES[this.sceneId] && !this.have.has(this.sceneId) && this.cols; }
  // returns true when the click picked up a stone (so the scene doesn't also react)
  pointer(x, y, kind) {
    this.px = x; this.py = y;
    if (kind === "down" && this.available() && this.dist() < 2.6) { this.collect(); return true; }
    return false;
  }
  collect() {
    this.have.add(this.sceneId); this.ring = 1; this.rest = 0;
    this.ringAt = this.pos(); this.ringCol = STONES[this.sceneId].col;
    this.onCollect && this.onCollect(this.sceneId, [...this.have]);
  }
  step(dt) {
    this.ring = Math.max(0, this.ring - dt * 1.2);
    if (this.dwell && this.available() && this.dist() < 2) {
      this.rest += dt;
      if (this.rest > 1.2) this.collect();
    } else this.rest = 0;
  }
  draw(G, C, t) {
    if (this.ring > 0 && this.ringAt) {               // a soft ring where it was picked up
      const [cx, cy] = this.ringAt, r = (1 - this.ring) * 9, [cr, cg, cb] = this.ringCol;
      for (let a = 0; a < Math.PI * 2; a += 0.12) G.set(cx + Math.cos(a) * r, cy + (Math.sin(a) * r) / ASPECT, C["."], cr * this.ring, cg * this.ring, cb * this.ring);
    }
    if (!this.available()) return;
    const d = this.dist();
    if (d > 7) return;                                // invisible unless you're close
    const [x, y] = this.pos(), [r, g, b] = STONES[this.sceneId].col;
    const k = Math.pow(1 - d / 7, 1.5) * (0.75 + 0.25 * Math.sin(t * 5));
    G.set(x, y, C["o"], r * k + 40 * k, g * k + 40 * k, b * k + 40 * k);
    if (d < 3.5) {                                    // a glint turning round it
      const ray = ["-", "\\", "|", "/"][Math.floor(t * 6) % 4];
      const j = 0.5 * k;
      G.set(x - 1, y, C[ray], r * j, g * j, b * j); G.set(x + 1, y, C[ray], r * j, g * j, b * j);
    }
    if (this.rest > 0) {                              // resting on it: a little progress arc
      for (let a = 0; a < (this.rest / 1.2) * Math.PI * 2; a += 0.5) G.set(x + Math.cos(a) * 2, y + Math.sin(a) * 2 / ASPECT, C["."], r, g, b);
    }
  }
}

// ================================================================ the snap
// Freezes the current frame, sweeps the six colours across it, turns exactly half of what's
// lit to dust, lets a cold iron-green tint creep in with a line of text, then brings
// everything back. onPhase(name) lets the page show / hide its text ("doom", "restore", "end").
const STONE_COLS = STONE_ORDER.map((id) => STONES[id].col);
export class Snap {
  constructor(onPhase) { this.onPhase = onPhase || (() => {}); this.active = false; }
  start(G) {
    const n = G.cols * G.rows;
    this.cols = G.cols; this.rows = G.rows;
    this.r = G.r.slice(0, n); this.g = G.g.slice(0, n); this.b = G.b.slice(0, n); this.code = G.code.slice(0, n);
    this.time = 0; this.active = true; this.phase = "band"; this.dust = null; this.gone = new Uint8Array(n);
    this.T = REDUCED ? { band: 0, dust: 1.2, doom: 3.2, back: 1 } : { band: 0.8, dust: 3.2, doom: 3.4, back: 1.6 };
    this.onPhase("start");
  }
  // any click / Esc while the line is showing skips to the restore
  skip() { if (this.active && this.phase !== "back") this.time = Math.max(this.time, this.T.band + this.T.dust + this.T.doom); }
  makeDust() {
    const { cols, rows } = this, list = [];
    for (let i = 0; i < cols * rows; i++) {
      if (this.r[i] + this.g[i] + this.b[i] < 24 || Math.random() >= 0.5) continue;   // half of what's lit
      const x = i % cols, y = (i / cols) | 0;
      const lum = this.r[i] + this.g[i] + this.b[i];
      list.push({ i, x, y, ox: x, oy: y, vis: lum > 110, at: (x / cols) * this.T.dust * 0.55 + Math.random() * 0.4, vx: rand(4, 12), vy: rand(-4, -0.5) });
    }
    this.dust = list;
  }
  step(dt) {
    if (!this.active) return;
    this.time += dt;
    const { band, dust, doom, back } = this.T, t = this.time;
    const phase = t < band ? "band" : t < band + dust ? "dust" : t < band + dust + doom ? "doom" : t < band + dust + doom + back ? "back" : "end";
    if (phase !== this.phase) {
      if (phase === "dust" || (phase !== "band" && !this.dust)) this.makeDust();
      this.phase = phase; this.onPhase(phase);
      if (phase === "back") for (const p of this.dust) { p.fx = p.x; p.fy = p.y; }
      if (phase === "end") { this.active = false; return; }
    }
    if (this.phase === "dust" || this.phase === "doom") {
      const local = t - band;
      for (const p of this.dust) {
        if (local < p.at) continue;
        this.gone[p.i] = 1;
        if (REDUCED) continue;
        const freeze = this.phase === "doom" ? 0.08 : 1;    // the dust hangs in the air
        p.x += p.vx * dt * freeze; p.y += p.vy * dt * freeze;
        p.vy -= 0.6 * dt; p.vx *= 1 - 0.15 * dt;
      }
    }
  }
  draw(G, C) {
    if (!this.active) return;
    const { cols, rows, T } = this, n = cols * rows, t = this.time;
    const back = this.phase === "back" ? clamp((t - T.band - T.dust - T.doom) / T.back, 0, 1) : 0;
    const ease = back * back * (3 - 2 * back);
    // how far the cold tint has crept in from the edges (0..1), fading out on the way back
    const doomK = this.phase === "doom" ? clamp((t - T.band - T.dust) / 1.4, 0, 1) : this.phase === "back" ? 1 - ease : 0;
    for (let i = 0; i < n; i++) {
      if (this.gone[i] && this.phase !== "back") { G.r[i] = 0; G.g[i] = 0; G.b[i] = 0; G.code[i] = C[" "]; continue; }
      let r = this.r[i], g = this.g[i], b = this.b[i];
      if (this.gone[i]) { r *= ease; g *= ease; b *= ease; }
      if (doomK > 0) {
        const x = i % cols, y = (i / cols) | 0;
        const edge = 1 - Math.min(x / cols, 1 - x / cols, (y / rows) * 1.2, 1 - y / rows) * 2;   // 1 at edges
        const k = clamp(doomK * 1.6 - (1 - edge), 0, 1) * 0.85;
        const l = (r + g + b) / 3;
        r += (l * 0.45 - r) * k; g += (l * 0.85 + 18 - g) * k; b += (l * 0.5 - b) * k;
        const dim = 1 - 0.45 * k * (1 - edge * 0.3); r *= dim; g *= dim; b *= dim;
      }
      G.r[i] = r; G.g[i] = g; G.b[i] = b; G.code[i] = this.code[i];
    }
    if (this.phase === "band" && !REDUCED) {          // six colours sweeping across
      const bx = (t / T.band) * (cols + 12) - 6;
      for (let y = 0; y < rows; y++) for (let k = 0; k < 6; k++) {
        const x = Math.round(bx - k), c = STONE_COLS[k], f = 1 - k / 7;
        G.set(x, y, C[k === 0 ? "|" : ":"], c[0] * f, c[1] * f, c[2] * f);
      }
    }
    if (this.dust && !REDUCED) for (const p of this.dust) {
      if (!this.gone[p.i] || !p.vis) continue;        // faint background just vanishes
      const age = clamp((t - T.band - p.at) / 1.6, 0, 1);
      let x = p.x, y = p.y, k = (1 - age) * 0.8 + 0.12;
      if (this.phase === "back") { x = p.fx + (p.ox - p.fx) * ease; y = p.fy + (p.oy - p.fy) * ease; k = 0.25 + 0.5 * ease; }
      // dust catches the light: brighter than what it came from, ash-warm, then cooling
      const l = Math.min(255, (this.r[p.i] + this.g[p.i] + this.b[p.i]) / 3 * 1.5 + 50);
      const cool = doomK;
      const wr = l * 0.95, wg = l * 0.78, wb = l * 0.6;           // warm ash
      G.set(x, y, C[age > 0.6 && this.phase !== "back" ? "." : ","], (wr * (1 - cool) + l * 0.5 * cool) * k, (wg * (1 - cool) + l * 0.9 * cool) * k, (wb * (1 - cool) + l * 0.55 * cool) * k);
    }
  }
}
