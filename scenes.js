// Built-in interactive wallpapers for the New Tab page.
// Each scene simulates something (water, butterflies…) on the character grid and paints
// a colour + character into every cell. The GPU renderer then draws it with glow.
//
// Scene API:  resize(cols, rows) · pointer(x, y, "move" | "down") · step(dt, t) · draw(grid)
// x / y are in cells. Cells are ~1.75x taller than wide, so distances scale y by ASPECT.

const ASPECT = 1.75;
const BRIGHT = 255;  // "choose a character by brightness"
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// "#1fa6ff" -> [r, g, b] in 0..1, scaled so the brightest channel is 1 (the hue, at full strength)
export function hexToTint(hex, fallback = [0.12, 0.65, 1]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const top = Math.max(...c, 0.001);
  return c.map((v) => v / top);
}
// a saturated colour for hue h (0..1), brightest channel = 1 — used by the "rainbow" colour
export function hueTint(h) {
  const k = (n) => (n + h * 6) % 6;
  const f = (n) => 1 - 0.78 * Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [f(5), f(3), f(1)];
}

// A paint buffer: float colour per cell + optional explicit character.
export class Grid {
  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    this.r = new Float32Array(cols * rows);
    this.g = new Float32Array(cols * rows);
    this.b = new Float32Array(cols * rows);
    this.code = new Uint8Array(cols * rows);
    this.out = new Uint8Array(cols * rows * 4);
  }
  clear() { this.r.fill(0); this.g.fill(0); this.b.fill(0); this.code.fill(BRIGHT); }
  // add light (brightness-chosen character); keeps explicit characters' shape
  add(x, y, r, g, b) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = y * this.cols + x;
    this.r[i] += r; this.g[i] += g; this.b[i] += b;
  }
  // a specific character in a specific colour
  set(x, y, code, r, g, b) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows || code === undefined) return;
    const i = y * this.cols + x;
    this.r[i] = r; this.g[i] = g; this.b[i] = b; this.code[i] = code;
  }
  pack() {
    const o = this.out, n = this.cols * this.rows;
    for (let i = 0; i < n; i++) {
      o[i * 4] = clamp(this.r[i], 0, 255);
      o[i * 4 + 1] = clamp(this.g[i], 0, 255);
      o[i * 4 + 2] = clamp(this.b[i], 0, 255);
      o[i * 4 + 3] = this.code[i];
    }
    return o;
  }
}

const edgeFor = (dx, dy, C) => {        // a stroke along a direction (screen y down)
  const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 180;
  return a < 22.5 || a >= 157.5 ? C["-"] : a < 67.5 ? C["\\"] : a < 112.5 ? C["|"] : C["/"];
};

// ---------------------------------------------------------------- Water
// A height-field wave simulation: click drops a stone, moving the mouse leaves a wake.
// Options: color (ripple colour), size (ripple size, 0.5..2), raindrops (the odd drop on its own)
export const WATER_DEFAULTS = { color: "#1fa6ff", size: 1, raindrops: true };
class Water {
  constructor(opts) { this.setOptions(opts); }
  setOptions(opts = {}) {
    this.opts = { ...WATER_DEFAULTS, ...this.opts, ...opts };
    this.rainbow = this.opts.color === "rainbow";       // colour drifts across the surface
    this.tint = hexToTint(this.opts.color);
  }
  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    this.cur = new Float32Array(cols * rows);
    this.prev = new Float32Array(cols * rows);
    this.last = null; this.rainClock = 0;
  }
  drop(x, y, radius, strength) {
    const { cols, rows } = this;
    radius *= this.opts.size;
    for (let dy = -Math.ceil(radius / ASPECT); dy <= Math.ceil(radius / ASPECT); dy++) {
      for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
        const d = Math.hypot(dx, dy * ASPECT) / radius;
        const cx = Math.round(x) + dx, cy = Math.round(y) + dy;
        if (d > 1 || cx < 1 || cy < 1 || cx >= cols - 1 || cy >= rows - 1) continue;
        this.cur[cy * cols + cx] -= strength * (Math.cos(d * Math.PI) * 0.5 + 0.5);
      }
    }
  }
  pointer(x, y, kind) {
    if (kind === "down") { this.drop(x, y, 4, 9); return; }
    if (this.last && Math.hypot(x - this.last[0], (y - this.last[1]) * ASPECT) > 0.8) this.drop(x, y, 1.6, 1.4);
    this.last = [x, y];
  }
  step(dt) {
    this.rainClock -= dt;
    if (this.opts.raindrops && this.rainClock < 0) {   // the odd raindrop
      this.rainClock = rand(0.4, 1.6);
      this.drop(rand(2, this.cols - 2), rand(2, this.rows - 2), rand(1.2, 2.2), rand(2, 4));
    }
    const { cols, rows, cur, prev } = this;
    const k = 0.34, wy = 1 / (ASPECT * ASPECT), damp = 0.986;
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x, c = cur[i];
        const lap = (cur[i - 1] + cur[i + 1] - 2 * c) + wy * (cur[i - cols] + cur[i + cols] - 2 * c) * 3;
        prev[i] = (2 * c - prev[i] + k * lap) * damp;
      }
    }
    this.cur = prev; this.prev = cur;
  }
  draw(G, C, t) {
    const { cols, rows, cur } = this;
    let [tr, tg, tb] = this.tint;
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x;
        if (this.rainbow) [tr, tg, tb] = hueTint((x / cols * 0.7 + y / rows * 0.3 + t * 0.03) % 1);
        const sx = cur[i + 1] - cur[i - 1], sy = cur[i + cols] - cur[i - cols];
        // calm water stays dark (faint dots); slopes catch the light, crests turn to foam
        const n = ((x * 73856093) ^ (y * 19349663)) & 255;
        const calm = 0.05 + 0.03 * Math.sin(t * 0.8 + n * 0.05);
        const slope = (-sx * 0.6 - sy * 0.4) * 0.7;
        const light = clamp(calm + Math.max(0, slope) + Math.abs(cur[i]) * 0.04, 0, 1);
        const foam = clamp((Math.abs(sx) + Math.abs(sy)) * 0.12 - 0.3, 0, 1);
        // the water takes the chosen colour; foam is a pale version of it
        G.r[i] = 255 * (0.85 * tr * light + (0.55 + 0.25 * tr) * foam);
        G.g[i] = 255 * (0.85 * tg * light + (0.55 + 0.25 * tg) * foam);
        G.b[i] = 255 * (0.85 * tb * light + (0.55 + 0.25 * tb) * foam);
      }
    }
  }
}

// ---------------------------------------------------------------- Butterflies
const WINGS = [[255, 170, 60], [120, 200, 255], [255, 110, 190], [255, 230, 90], [170, 140, 255], [120, 240, 170]];
class Butterflies {
  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    const n = clamp(Math.round((cols * rows) / 900), 8, 26);
    this.flock = Array.from({ length: n }, () => ({
      x: rand(0, cols), y: rand(2, rows * 0.75), vx: 0, vy: 0,
      heading: rand(0, Math.PI * 2), phase: rand(0, 6), fear: 0,
      col: WINGS[(Math.random() * WINGS.length) | 0], bob: rand(0, 6),
    }));
    this.flowers = Array.from({ length: Math.round(cols / 5) }, () => ({
      x: rand(0, cols), h: rand(1, 4), col: WINGS[(Math.random() * WINGS.length) | 0], c: Math.random() < 0.5 ? "*" : "@",
    }));
    this.px = -999; this.py = -999;
  }
  pointer(x, y, kind) {
    this.px = x; this.py = y;
    if (kind !== "down") return;
    for (const b of this.flock) {                  // a click startles everyone nearby
      const dx = b.x - x, dy = (b.y - y) * ASPECT, d = Math.hypot(dx, dy) || 1;
      if (d < 30) { b.fear = 1; b.vx += (dx / d) * 40; b.vy += (dy / d / ASPECT) * 40; }
    }
  }
  step(dt, t) {
    const { cols, rows } = this;
    for (const b of this.flock) {
      b.heading += (Math.sin(t * 0.7 + b.bob * 3) * 1.6 + rand(-1, 1)) * dt;
      let ax = Math.cos(b.heading) * 7, ay = Math.sin(b.heading) * 7 / ASPECT;
      const dx = b.x - this.px, dy = (b.y - this.py) * ASPECT, d = Math.hypot(dx, dy) || 1;
      if (d < 14) {                                 // too close to the cursor: flee
        const push = (14 - d) / 14;
        ax += (dx / d) * 90 * push; ay += (dy / d / ASPECT) * 90 * push;
        b.fear = Math.max(b.fear, push);
      }
      if (b.y < 2) ay += 20; if (b.y > rows * 0.82) ay -= 20;   // stay above the flowers
      b.vx += (ax * (1 + 2 * b.fear) - b.vx) * Math.min(1, dt * 2.5);
      b.vy += (ay * (1 + 2 * b.fear) - b.vy) * Math.min(1, dt * 2.5);
      b.x += b.vx * dt; b.y += (b.vy + Math.sin(t * 3 + b.bob) * 0.8) * dt;
      if (b.x < -3) b.x += cols + 6; if (b.x > cols + 3) b.x -= cols + 6;
      b.fear = Math.max(0, b.fear - dt * 0.6);
      b.phase += dt * (9 + 14 * b.fear);
    }
  }
  draw(G, C, t) {
    const { cols, rows } = this;
    for (let y = 0; y < rows; y++) {                // dusk sky: deep blue fading to warm
      const k = y / rows;
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const n = 0.04 + 0.03 * Math.sin(x * 0.5 + y * 1.3 + t * 0.2);
        G.r[i] = (20 + 60 * k) * n * 4; G.g[i] = (24 + 20 * k) * n * 4; G.b[i] = (60 - 10 * k) * n * 4;
      }
    }
    const ground = Math.floor(rows * 0.86);
    for (let x = 0; x < cols; x++) {                // swaying grass
      const sway = Math.sin(x * 0.4 + t * 1.3) * 0.5 + Math.sin(this.px * 0.1 - x * 0.2) * 0.2;
      for (let y = ground; y < rows; y++) {
        const ch = y === ground ? (sway > 0.25 ? "/" : sway < -0.25 ? "\\" : "|") : (x + y) % 3 ? "," : ";";
        G.set(x, y, C[ch], 40, 120 + 40 * Math.sin(x), 60);
      }
    }
    for (const f of this.flowers) G.set(f.x, ground - f.h * 0.3, C[f.c], ...f.col);
    for (const b of this.flock) {
      const open = Math.sin(b.phase) > 0;
      const [r, g, bl] = b.col;
      const L = open ? ["\\", "/", "/", "\\"] : ["(", ")", "(", ")"];
      G.set(b.x - 1, b.y, C[L[0]], r, g, bl); G.set(b.x + 1, b.y, C[L[1]], r, g, bl);
      G.set(b.x - 1, b.y + 1, C[L[2]], r * 0.8, g * 0.8, bl * 0.8); G.set(b.x + 1, b.y + 1, C[L[3]], r * 0.8, g * 0.8, bl * 0.8);
      G.set(b.x, b.y, C["|"], 235, 225, 210); G.set(b.x, b.y + 1, C["|"], 200, 190, 175);
    }
  }
}

// ---------------------------------------------------------------- Fireflies
class Fireflies {
  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    const n = clamp(Math.round((cols * rows) / 140), 40, 220);
    this.bugs = Array.from({ length: n }, () => ({
      x: rand(0, cols), y: rand(0, rows), vx: rand(-2, 2), vy: rand(-1, 1),
      phase: rand(0, 6), rate: rand(0.6, 1.6), flash: 0, seed: Math.random(),
    }));
    this.px = cols / 2; this.py = rows / 2; this.active = 0;
  }
  pointer(x, y, kind) {
    this.px = x; this.py = y; this.active = 3;      // gather for a few seconds after moving
    if (kind !== "down") return;
    for (const b of this.bugs) {                    // a click: flash and scatter
      const dx = b.x - x, dy = (b.y - y) * ASPECT, d = Math.hypot(dx, dy) || 1;
      if (d < 40) { b.flash = 1; b.vx += (dx / d) * (40 - d) * 1.2; b.vy += (dy / d / ASPECT) * (40 - d) * 1.2; }
    }
  }
  step(dt, t) {
    this.active = Math.max(0, this.active - dt);
    for (const b of this.bugs) {
      let ax = Math.sin(t * 0.5 + b.seed * 20) * 3, ay = Math.cos(t * 0.4 + b.seed * 13) * 1.5;
      if (this.active > 0) {                        // drift toward the cursor and circle it
        const dx = this.px - b.x, dy = (this.py - b.y) * ASPECT, d = Math.hypot(dx, dy) || 1;
        const pull = Math.min(1, this.active) * clamp(d / 30, 0.2, 1) * 9;
        ax += (dx / d) * pull - (dy / d) * 5; ay += ((dy / d) * pull + (dx / d) * 5) / ASPECT;
      }
      b.vx += (ax - b.vx * 0.9) * dt; b.vy += (ay - b.vy * 0.9) * dt;
      b.x = (b.x + b.vx * dt + this.cols) % this.cols;
      b.y = clamp(b.y + b.vy * dt, 0, this.rows - 1);
      b.phase += dt * b.rate * 2;
      b.flash = Math.max(0, b.flash - dt * 1.2);
    }
  }
  draw(G, C, t) {
    const { cols, rows } = this;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x, k = y / rows;
        const star = k < 0.5 && ((x * 7919 + y * 104729) % 97) === 0 ? 30 + 25 * Math.sin(t + x) : 0;
        G.r[i] = 6 + star; G.g[i] = 10 + 18 * k + star; G.b[i] = 26 + star;
      }
    }
    for (let x = 0; x < cols; x++) {                // dark treeline
      const h = Math.floor(rows * (0.12 + 0.06 * Math.sin(x * 0.11) + 0.04 * Math.sin(x * 0.37 + 1)));
      for (let y = rows - h; y < rows; y++) G.set(x, y, C[(x + y) % 4 ? ";" : "|"], 14, 40, 26);
    }
    for (const b of this.bugs) {
      const glow = Math.pow(Math.max(0, Math.sin(b.phase)), 3) * 0.9 + 0.1 + b.flash;
      const r = 255 * glow, g = 235 * glow, bl = 110 * glow;
      for (let dx = -2; dx <= 2; dx++) G.add(b.x + dx, b.y, r * 0.18 / (1 + Math.abs(dx)), g * 0.18 / (1 + Math.abs(dx)), bl * 0.1);
      G.add(b.x, b.y - 1, r * 0.1, g * 0.1, 0); G.add(b.x, b.y + 1, r * 0.1, g * 0.1, 0);
      if (glow > 0.35) G.set(b.x, b.y, C[glow > 0.8 ? "@" : glow > 0.55 ? "*" : "o"], r, g, bl);
    }
  }
}

// ---------------------------------------------------------------- Rain
// Options: umbrella (a dry circle around the cursor), fluid (the rain flows around the cursor and
// is swept along when it moves), strength (how strongly it flows, 0.3..2), color (rain colour)
const RAIN_CHARS = "01lizxtfoeasun{}[]<>?%$#&8B@QWM*+=:;";   // all in the glyph sheet
const NO_FLOW = [0, 0];
export const RAIN_DEFAULTS = { umbrella: true, fluid: false, strength: 1, color: "#39e07a" };
class Rain {
  constructor(opts) { this.setOptions(opts); }
  setOptions(opts = {}) {
    this.opts = { ...RAIN_DEFAULTS, ...this.opts, ...opts };
    this.rainbow = this.opts.color === "rainbow";       // every column its own slowly shifting colour
    this.tint = hexToTint(this.opts.color, [0.15, 1, 0.4]);
  }
  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    this.drops = [];
    for (let x = 0; x < cols; x++) for (let k = 0; k < 2; k++) this.drops.push(this.newDrop(x, rand(-rows, rows)));
    this.px = -999; this.py = -999; this.vx = 0; this.vy = 0; this.waves = [];
  }
  newDrop(x, y) { return { x, y, speed: rand(8, 26), len: rand(6, 26), seed: Math.random() * 1000 }; }
  pointer(x, y, kind) {
    const now = performance.now();
    if (this.px > -900 && this.pt) {                         // how fast the cursor is moving
      const dt = Math.max(0.016, (now - this.pt) / 1000);
      this.vx = this.vx * 0.5 + ((x - this.px) / dt) * 0.5;
      this.vy = this.vy * 0.5 + ((y - this.py) / dt) * 0.5;
    }
    this.px = x; this.py = y; this.pt = now;
    if (kind === "down") this.waves.push({ x, y, r: 0 });
  }
  step(dt) {
    for (const d of this.drops) {
      d.y += d.speed * dt;
      if (d.y - d.len > this.rows) Object.assign(d, this.newDrop(d.x, rand(-20, 0)));
    }
    for (const w of this.waves) w.r += 60 * dt;
    this.waves = this.waves.filter((w) => w.r < Math.max(this.cols, this.rows * ASPECT));
    const calm = Math.exp(-dt * 4);                           // the cursor's wake dies down
    this.vx *= calm; this.vy *= calm;
  }
  // Fluid: like dragging a finger through a thin, smooth (laminar) sheet of falling water.
  // Each stream follows a streamline of ideal flow past a round obstacle (the cursor):
  // streams start bending just before it, wrap round both sides (running faster, so brighter),
  // then leave a teardrop-shaped dry wake that slowly closes up downstream.
  // Returns [sideways offset in cells, extra brightness 0..1].
  flow(x, y) {
    if (!this.opts.fluid || this.px < -900) return NO_FLOW;
    const a = 6 * this.opts.strength;                       // the "finger" radius, in cells
    const b = x - this.px;                                  // where this stream would be with no finger
    let yy = (y - this.py) * ASPECT;                        // along the stream (down = positive)
    let off = 0, glow = 0;
    // moving the cursor drags nearby water along with it (soft, fades with distance)
    const drag = clamp(this.vx * 0.035, -9, 9) * Math.exp(-((b * b + yy * yy) / (a * a * 6)));
    if (yy > 0) yy *= 0.32;                                 // downstream: the wake lingers ~3x longer
    if (Math.abs(b) < a * 5 && Math.abs(yy) < a * 6) {
      // find the streamline: solve  X (1 - a^2 / (X^2 + yy^2)) = b  for X outside the obstacle
      const sgn = b === 0 ? 1 : Math.sign(b), bb = Math.abs(b);
      let lo = Math.sqrt(Math.max(0, a * a - yy * yy)), hi = bb + a;
      for (let k = 0; k < 16; k++) {
        const mid = (lo + hi) / 2;
        if (mid * (1 - (a * a) / (mid * mid + yy * yy)) < bb) lo = mid; else hi = mid;
      }
      const X = (lo + hi) / 2;
      off = sgn * (X - bb);
      const r2 = X * X + yy * yy;
      glow = clamp((a * a) / r2, 0, 1) ** 1.5;              // faster water round the sides catches the light
    }
    return [off + drag, glow];
  }
  hidden(x, y) {
    if (this.opts.umbrella && Math.hypot(x - this.px, (y - this.py) * ASPECT) < 9) return 1;   // the umbrella
    for (const w of this.waves) {
      const dw = Math.hypot(x - w.x, (y - w.y) * ASPECT);
      if (dw < w.r && dw > w.r - 10) return 2;               // the shockwave ring
    }
    return 0;
  }
  draw(G, C, t) {
    const tick = Math.floor(t * 12);
    let [tr, tg, tb] = this.tint;
    for (const d of this.drops) {
      if (this.rainbow) [tr, tg, tb] = hueTint((d.x / this.cols + t * 0.04) % 1);
      for (let k = 0; k < d.len; k++) {
        const y = Math.floor(d.y) - k;
        if (y < 0 || y >= this.rows) continue;
        const [off, glow] = this.flow(d.x, y);
        const x = d.x + off;
        const h = this.hidden(x, y);
        if (h === 1) continue;
        const fade = Math.min(1, (1 - k / d.len) * (1 + glow * 0.9));
        const ch = RAIN_CHARS[(Math.floor(d.seed + y * 7.3 + (k < 3 ? tick : tick / 4)) % RAIN_CHARS.length + RAIN_CHARS.length) % RAIN_CHARS.length];
        if (h === 2) { G.set(x, y, C[ch], 120 + 135 * tr, 120 + 135 * tg, 120 + 135 * tb); continue; }
        if (k === 0) G.set(x, y, C[ch], 170 + 85 * tr, 170 + 85 * tg, 170 + 85 * tb);   // a bright head
        else G.set(x, y, C[ch], 25 + 230 * tr * fade, 25 + 230 * tg * fade, 25 + 230 * tb * fade);
      }
    }
    // a faint ring shows where the umbrella is
    if (this.opts.umbrella) {
      for (let a = 0; a < Math.PI * 2; a += 0.12) {
        G.add(this.px + Math.cos(a) * 9.5, this.py + Math.sin(a) * 9.5 / ASPECT, 40 * tr * 0.4, 40 * tg, 40 * tb * 0.5);
      }
    }
  }
}

// ---------------------------------------------------------------- Starfield
class Stars {
  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    this.stars = Array.from({ length: clamp(Math.round((cols * rows) / 40), 150, 700) }, () => this.spawn(rand(0.05, 1)));
    this.cx = cols / 2; this.cy = rows / 2; this.tx = this.cx; this.ty = this.cy; this.warp = 0;
  }
  spawn(z = 1) {
    const hue = Math.random();
    return { x: rand(-1, 1), y: rand(-1, 1), z, col: hue < 0.7 ? [220, 230, 255] : hue < 0.85 ? [255, 210, 160] : [170, 190, 255] };
  }
  pointer(x, y, kind) {
    this.tx = this.cols / 2 + (x - this.cols / 2) * 0.35;   // the view leans toward the cursor
    this.ty = this.rows / 2 + (y - this.rows / 2) * 0.35;
    if (kind === "down") this.warp = 1;
  }
  project(s) {
    const scale = this.cols * 0.5;
    return [this.cx + (s.x / s.z) * scale, this.cy + ((s.y / s.z) * scale) / ASPECT];
  }
  step(dt) {
    this.cx += (this.tx - this.cx) * Math.min(1, dt * 3);
    this.cy += (this.ty - this.cy) * Math.min(1, dt * 3);
    const speed = 0.12 + this.warp * 1.6;
    for (const s of this.stars) {
      s.pz = s.z;
      s.z -= speed * dt * (0.6 + 0.4 * (1 - s.z));
      if (s.z < 0.02) Object.assign(s, this.spawn(1), { pz: 1 });
    }
    this.warp = Math.max(0, this.warp - dt * 0.45);
  }
  draw(G, C) {
    const { cols, rows } = this;
    // deep space: black, so only the stars draw
    for (const s of this.stars) {
      const [x, y] = this.project(s);
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const near = 1 - s.z, k = 0.25 + near * 0.95;
      const [r, g, b] = s.col;
      if (this.warp > 0.15 && s.pz) {                // hyperspace: draw a streak back along the path
        const [px, py] = this.project({ ...s, z: Math.min(1, s.z + 0.1 * this.warp) });
        const steps = Math.min(30, Math.ceil(Math.hypot(x - px, y - py)));
        const ch = edgeFor(x - px, (y - py) * ASPECT, C);
        for (let j = 0; j <= steps; j++) {
          const f = j / Math.max(1, steps);
          G.set(px + (x - px) * f, py + (y - py) * f, ch, r * k * f, g * k * f, b * k * f);
        }
      } else {
        G.set(x, y, C[near > 0.85 ? "@" : near > 0.65 ? "*" : near > 0.35 ? "+" : "."], r * k, g * k, b * k);
      }
    }
  }
}


// ================================================================ Christmas
// Four festive scenes. They use only characters the renderer already has.
export const REDUCED = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const hash = (x, y) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };
// a night sky: empty (no characters), with a few twinkling stars in the top part
function nightSky(G, C, cols, rows, t, stars = 0.5) {
  const blank = C[" "], dot = C["."];
  for (let y = 0; y < rows; y++) {
    const k = y / rows;
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (k < stars && hash(x, y) > 0.985) {
        const tw = 0.5 + 0.5 * Math.sin(t * (1 + hash(y, x) * 2) + x);
        G.code[i] = dot; G.r[i] = 120 + 110 * tw; G.g[i] = 130 + 110 * tw; G.b[i] = 170 + 80 * tw;
      } else { G.code[i] = blank; G.r[i] = 0; G.g[i] = 0; G.b[i] = 0; }
    }
  }
}

// ---------------------------------------------------------------- Snowfall
// Flakes drift down in layers and pile up along the bottom. The cursor is warm: flakes swirl
// round it and melt, and it brushes the pile away. Click for a gust of wind.
export const SNOW_DEFAULTS = { color: "#e8f0ff", amount: 1, pile: true };
class Snow {
  constructor(opts) { this.setOptions(opts); }
  setOptions(opts = {}) {
    this.opts = { ...SNOW_DEFAULTS, ...this.opts, ...opts };
    this.rainbow = this.opts.color === "rainbow";
    this.tint = hexToTint(this.opts.color, [0.9, 0.94, 1]);
    if (this.cols) this.spawnAll();
  }
  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    // start with a gentle, rolling snowbank; it keeps building from there
    this.pile = Float32Array.from({ length: cols }, (_, x) => rows * 0.04 * (1 + 0.55 * Math.sin(x * 0.045 + 1) + 0.25 * Math.sin(x * 0.13)));
    this.px = -999; this.py = -999; this.gust = 0; this.gustDir = 1;
    this.spawnAll();
  }
  spawnAll() {
    const n = Math.round(clamp((this.cols * this.rows) / 55, 120, 1100) * this.opts.amount);
    this.flakes = Array.from({ length: n }, () => this.spawn(rand(0, this.rows)));
  }
  spawn(y = -1) { return { x: rand(-5, this.cols + 5), y, z: Math.pow(Math.random(), 0.7), ph: rand(0, 6) }; }
  pointer(x, y, kind) {
    this.px = x; this.py = y;
    if (kind === "down" && !REDUCED) { this.gust = 1; this.gustDir = x < this.cols / 2 ? 1 : -1; }
  }
  step(dt, t) {
    const { cols, rows } = this, slow = REDUCED ? 0.45 : 1;
    const wind = (Math.sin(t * 0.13) * 1.6 + Math.sin(t * 0.41) * 0.6 + this.gust * 26 * this.gustDir) * slow;
    this.gust = Math.max(0, this.gust - dt * 0.6);
    for (const f of this.flakes) {
      let vx = wind * (0.4 + f.z) + Math.sin(t * 1.3 + f.ph) * 0.7;
      let vy = (1.6 + 5 * f.z) * slow;
      const dx = f.x - this.px, dy = (f.y - this.py) * ASPECT, d = Math.hypot(dx, dy);
      if (d < 7) {                                   // warm cursor: swirl round it
        const k = (7 - d) / 7;
        vx += (-dy / (d || 1)) * 9 * k + (dx / (d || 1)) * 6 * k;
        vy += ((dx / (d || 1)) * 9 * k + (dy / (d || 1)) * 6 * k) / ASPECT;
        if (d < 1.6) { Object.assign(f, this.spawn()); continue; }   // ...and melt
      }
      f.x += vx * dt; f.y += vy * dt;
      if (f.x < -6) f.x += cols + 12; else if (f.x > cols + 6) f.x -= cols + 12;
      const cx = f.x | 0;
      const ground = rows - (this.opts.pile && cx >= 0 && cx < cols ? this.pile[cx] : 0);
      if (f.y >= ground) {
        if (this.opts.pile && cx >= 0 && cx < cols && f.z > 0.35) {
          const add = 0.3 + 0.35 * f.z;                  // a landing flake spreads a little sideways
          for (let k = -2; k <= 2; k++) { const j = cx + k; if (j >= 0 && j < cols) this.pile[j] = Math.min(rows * 0.2, this.pile[j] + add * [0.1, 0.2, 0.4, 0.2, 0.1][k + 2]); }
        }
        Object.assign(f, this.spawn());
      }
    }
    if (!this.opts.pile) return;
    const p = this.pile, next = p.slice();
    for (let x = 1; x < cols - 1; x++) {             // snow settles: steep steps slide down
      next[x] += ((p[x - 1] + p[x + 1]) / 2 - p[x]) * Math.min(1, dt * 3);   // snow settles smooth
      next[x] = Math.max(0, next[x] - dt * 0.004);   // and slowly melts, so it never fills up
    }
    if (this.py > rows - p[clamp(this.px | 0, 0, cols - 1)] - 2) {   // brushing the pile
      for (let x = Math.max(0, (this.px | 0) - 3); x < Math.min(cols, (this.px | 0) + 4); x++) next[x] = Math.max(0, next[x] - dt * 6);
    }
    this.pile = next;
  }
  draw(G, C, t) {
    const { cols, rows } = this;
    nightSky(G, C, cols, rows, t, 0.6);
    let [tr, tg, tb] = this.tint;
    for (const f of this.flakes) {
      if (this.rainbow) [tr, tg, tb] = hueTint((f.ph / 6 + t * 0.05) % 1);
      const k = 0.35 + 0.65 * f.z;
      const ch = f.z > 0.9 ? "*" : f.z > 0.7 ? "+" : f.z > 0.4 ? "'" : ".";
      G.set(f.x, f.y, C[ch], 255 * tr * k, 255 * tg * k, 255 * tb * k);
    }
    if (!this.opts.pile) return;
    for (let x = 0; x < cols; x++) {
      const h = this.pile[x];
      if (h < 0.15) continue;
      const top = rows - h, ty = Math.floor(top);
      const l = x > 0 ? this.pile[x - 1] : h, r = x < cols - 1 ? this.pile[x + 1] : h;
      const ch = r - l > 0.5 ? "/" : l - r > 0.5 ? "\\" : h - Math.floor(h) > 0.5 ? "-" : "_";
      G.set(x, ty, C[ch], 225, 235, 255);
      for (let y = ty + 1; y < rows; y++) {
        const k = 0.55 + 0.25 * hash(x, y);
        G.set(x, y, C[(x + y) % 4 ? "=" : "#"], 170 * k, 185 * k, 215 * k);
      }
    }
  }
}

// ---------------------------------------------------------------- Christmas tree
// A slowly turning 3D tree built from characters: layered branches lit from one side, a gold
// garland spiralling up, shiny baubles, twinkling lights, presents with bows and a star.
// It grows in from the bottom when it first appears. Move the mouse sideways to spin it,
// hover to brighten the lights, click to shake sparkles off the branches.
export const TREE_DEFAULTS = { lights: "warm" };
const LIGHTS = {
  warm: [[255, 226, 150], [255, 205, 120], [255, 240, 190]],
  multi: [[255, 80, 80], [255, 210, 80], [90, 170, 255], [100, 235, 130], [255, 130, 220]],
  ice: [[180, 225, 255], [130, 195, 255], [235, 248, 255]],
};
const NEEDLES = "xvV^W%&#*+";
const TILT = 0.24;                                 // we look down on the tree a little
const smooth = (v) => { const x = clamp(v, 0, 1); return x * x * (3 - 2 * x); };
class Tree {
  constructor(opts) { this.setOptions(opts); this.age = REDUCED ? 30 : 0; }
  setOptions(opts = {}) { this.opts = { ...TREE_DEFAULTS, ...this.opts, ...opts }; }
  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    // world units: 1 = one character width; y grows downward from the tip
    this.H = rows * 0.64 * ASPECT;
    this.R = Math.min(this.H * 0.56, cols * 0.33);
    this.cx = cols / 2; this.top = rows * 0.13;
    this.zbuf = new Float32Array(cols * rows);
    this.rot = 0; this.spin = 0; this.px = -999; this.py = -999; this.lastX = null;
    this.sparks = []; this.flash = 0;
    let seed = 2026;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const { H, R } = this, rAt = (f) => R * (0.03 + 0.97 * Math.pow(f, 0.95));
    this.rAt = rAt;
    const pts = [];
    const add = (y, r, ang, ch, shade, snowy, birth) => pts.push({ y, r, c: Math.cos(ang), s: Math.sin(ang), ch, shade, snowy, birth });
    for (let k = 0; k <= H; k += 0.9) {              // a solid crown so the silhouette has no holes
      const f = k / H, r = rAt(f) * 0.78, n = Math.max(8, Math.round(r * 2.4));
      for (let j = 0; j < n; j++) add(k, r, (j / n) * Math.PI * 2, "v^x"[(rnd() * 3) | 0], 0.4 + rnd() * 0.15, false, 0.4 + (1 - f) * 3.2);
    }
    const tiers = Math.round(clamp(rows / 4.5, 10, 20));
    for (let t = 0; t < tiers; t++) {                // whorls of branches that droop at the tips
      const f = 0.03 + (t / (tiers - 1)) * 0.95, rad = rAt(f), nb = Math.floor(6 + f * 11);
      for (let b = 0; b < nb; b++) {
        const dir = (b / nb) * Math.PI * 2 + t * 2.39996, len = rad * (0.95 + rnd() * 0.3);
        const count = Math.floor(14 + len * 2.2);
        for (let j = 0; j < count; j++) {
          const reach = Math.pow(rnd(), 0.55), side = (rnd() + rnd() - 1) * (0.5 + reach * len * 0.16);
          const x = Math.cos(dir) * len * reach - Math.sin(dir) * side, z = Math.sin(dir) * len * reach + Math.cos(dir) * side;
          const y = f * H - H * 0.016 * reach + H * 0.04 * reach * reach + (rnd() - 0.5) * 1.2;
          add(y, Math.hypot(x, z), Math.atan2(z, x), NEEDLES[(rnd() * NEEDLES.length) | 0], 0.62 + reach * 0.45 + rnd() * 0.12, reach > 0.7 && rnd() < 0.06, 0.4 + (1 - f) * 3.2 + reach * 0.25);
        }
      }
    }
    this.needles = pts;
    this.garland = [];
    for (let i = 0, n = Math.round(H * 14); i < n; i++) {
      const p = i / (n - 1), f = 0.95 - p * 0.86, a = f * Math.PI * 2 * 3.2;
      for (const dy of [-1, 0, 1]) this.garland.push({ y: f * H + dy * 0.9 + Math.abs(Math.sin(a * 2.5)) * 1.4, r: rAt(f) * 1.14, c: Math.cos(a), s: Math.sin(a), ch: dy ? "~=-"[i % 3] : "#@="[i % 3], birth: 3.8 + p * 1.6 });
    }
    this.balls = [];
    for (let i = 0; i < 22; i++) {
      const f = 0.14 + (i / 22) * 0.8, a = i * 2.39996;
      this.balls.push({ y: f * H, r: rAt(f) * 1.1 + 0.6, c: Math.cos(a), s: Math.sin(a), size: 1.8 + f * 1.8, col: i % 3, birth: 5.4 + (1 - f) * 1.2 });
    }
    this.lights = [];
    for (let i = 0, n = Math.round(H * 1.7); i < n; i++) {
      const f = 0.05 + (i / n) * 0.93, a = i * 2.39996;
      this.lights.push({ y: f * H, r: rAt(f) * 1.16, c: Math.cos(a), s: Math.sin(a), ph: rnd() * 6.3, k: i, birth: 6.6 + rnd() * 0.9 });
    }
    const gifts = [[[220, 45, 60], [255, 215, 110]], [[70, 95, 215], [255, 215, 110]], [[210, 160, 60], [220, 45, 60]], [[40, 150, 100], [255, 215, 110]], [[220, 45, 60], [235, 228, 210]]];
    this.gifts = gifts.map(([col, rib], i) => {
      const a = Math.PI / 10 + (i * Math.PI * 2) / 5;
      return { x: Math.cos(a) * R * 1.15, z: Math.sin(a) * R * 1.15, w: R * (0.26 + 0.04 * (i % 3)), d: R * 0.24, h: R * (0.34 + 0.06 * ((i + 1) % 3)), col, rib, birth: 6 + i * 0.2 };
    });
    // the snowy clearing round the base: fixed, so worked out once
    this.ground = [];
    const floorY = H + 2.5;
    for (let z = -R * 1.4; z <= R * 1.4; z += 1.7) for (let x = -R * 1.7; x <= R * 1.7; x += 1) {
      const e = Math.hypot(x / (R * 1.6), z / (R * 1.35));
      if (e > 1.05 || hash(x * 1.3, z * 2.9) < 0.12) continue;
      const row = Math.round(this.top + (floorY + z * TILT) / ASPECT), col = Math.round(this.cx + x);
      const n = hash(x * 3.1, z * 1.7), b = (1 - smooth((e - 0.65) / 0.43)) * (0.6 + 0.4 * n);
      this.ground.push([col, row, n > 0.95 ? "*" : n > 0.8 ? "+" : n > 0.4 ? "-" : ".", b * 0.95]);
    }
    this.snow = Array.from({ length: clamp(Math.round((cols * rows) / 140), 40, 420) }, () => ({ x: rand(0, cols), y: rand(0, rows), z: Math.random() }));
  }
  pointer(x, y, kind) {
    if (this.lastX !== null && kind === "move") this.spin = clamp(this.spin + (x - this.lastX) * 0.035, -3, 3);
    this.lastX = x; this.px = x; this.py = y;
    if (kind !== "down") return;
    this.flash = REDUCED ? 0 : 1;
    for (let i = 0; i < (REDUCED ? 25 : 120); i++) {
      const f = rand(0.05, 1), a = rand(0, 6.3), r = this.rAt(f);
      this.sparks.push({ x: this.cx + Math.cos(a) * r, y: this.top + (f * this.H) / ASPECT, vx: rand(-5, 5), vy: rand(-7, 1), life: rand(1, 2.4) });
    }
  }
  step(dt) {
    this.age += dt;
    this.rot += ((REDUCED ? 0.08 : 0.22) + this.spin) * dt;
    this.spin *= Math.pow(0.35, dt);
    for (const f of this.snow) {
      f.y += (1 + 3 * f.z) * dt * (REDUCED ? 0.5 : 1); f.x += Math.sin(f.y * 0.3) * 0.3 * dt;
      if (f.y > this.rows) { f.y = -1; f.x = rand(0, this.cols); }
    }
    for (const s of this.sparks) { s.vy += 9 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }
    this.sparks = this.sparks.filter((s) => s.life > 0 && s.y < this.rows);
    this.flash = Math.max(0, this.flash - dt * 1.5);
  }
  draw(G, C, t) {
    const { cols, rows, cx, top, zbuf, age } = this;
    nightSky(G, C, cols, rows, t, 0.5);
    for (const f of this.snow) { const k = 0.3 + 0.6 * f.z; G.set(f.x, f.y, C[f.z > 0.75 ? "*" : "."], 220 * k, 232 * k, 250 * k); }
    for (const [x, y, ch, b] of this.ground) G.set(x, y, C[ch], 200 * b, 215 * b, 235 * b);
    zbuf.fill(-1e9);
    const cr = Math.cos(this.rot), sr = Math.sin(this.rot);
    // one cell, if it's nearer than what's already there
    const put = (x, y, z, ch, r, g, b) => {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= cols || y >= rows) return;
      const i = y * cols + x;
      if (z < zbuf[i]) return;
      zbuf[i] = z; G.r[i] = r; G.g[i] = g; G.b[i] = b; G.code[i] = C[ch];
    };
    const sx = (p) => p.c * cr + p.s * sr, sz = (p) => p.s * cr - p.c * sr;   // turn by this.rot
    const row = (y, z) => top + (y + z * TILT) / ASPECT;
    // trunk
    for (let y = this.H - 1; y < this.H + 3; y += 0.8) for (let x = -1; x <= 1; x++) put(cx + x, row(y, 0), -this.R * 0.3, "#", 120, 85, 50);
    for (const p of this.needles) {
      const a = age - p.birth;
      if (a < 0) continue;
      const fl = 1 - smooth(a / 0.4), ux = sx(p), uz = sz(p);
      // lit from the front left, so the tree reads as round
      const z = uz * p.r, lit = (0.5 + 0.7 * clamp((-ux * 0.55 + uz * 0.85 + 1) / 2, 0, 1)) * p.shade;
      const [r, g, b] = p.snowy ? [215, 235, 228] : [80, 218, 112];
      put(cx + ux * p.r, row(p.y, z), z, fl > 0.35 ? "#" : p.snowy ? "*" : p.ch, r * lit * (1 - fl) + 240 * fl, g * lit * (1 - fl) + 240 * fl, b * lit * (1 - fl) + 240 * fl);
    }
    for (const p of this.garland) {
      if (age < p.birth) continue;
      const ux = sx(p), uz = sz(p), z = uz * p.r + 0.6, k = 0.75 + 0.25 * (uz + 1) / 2;
      put(cx + ux * p.r, row(p.y, z), z, p.ch, 255 * k, 222 * k, 130 * k);
    }
    const ballCols = [[235, 50, 65], [255, 205, 90], this.opts.lights === "ice" ? [120, 180, 255] : [235, 50, 65]];
    for (const p of this.balls) {
      const grow = smooth((age - p.birth) / 0.35);
      if (grow <= 0) continue;
      const ux = sx(p), uz = sz(p), z0 = uz * p.r, bx = cx + ux * p.r, by = row(p.y, z0), sz0 = p.size * grow, col = ballCols[p.col];
      for (let dy = -sz0 / ASPECT; dy <= sz0 / ASPECT; dy += 1) for (let dx = -sz0; dx <= sz0; dx += 1) {
        const d = (dx * dx + (dy * ASPECT) ** 2) / (sz0 * sz0);
        if (d > 1) continue;
        const sh = 0.5 + 0.5 * Math.sqrt(1 - d), hl = Math.exp(-((dx / sz0 + 0.35) ** 2 + ((dy * ASPECT) / sz0 + 0.4) ** 2) * 6);
        put(bx + dx, by + dy, z0 + Math.sqrt(1 - d) * sz0 + 0.8, hl > 0.6 ? "*" : d < 0.45 ? "@" : "%", col[0] * sh + (255 - col[0] * sh) * hl * 0.8, col[1] * sh + (255 - col[1] * sh) * hl * 0.8, col[2] * sh + (255 - col[2] * sh) * hl * 0.8);
      }
    }
    for (const gft of this.gifts) {                  // presents on the floor, turning with the tree
      const grow = smooth((age - gft.birth) / 0.5);
      if (grow <= 0) continue;
      const floor = this.H + 2.5, h = gft.h * grow;
      const faces = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0], [0, -1, 0]];
      for (const [nx, ny, nz] of faces) {
        const nzv = nz * cr - nx * sr;
        if (!ny && nzv <= 0) continue;               // faces turned away aren't drawn
        const across = nz ? gft.w : gft.d, up = ny ? gft.d : h;
        for (let u = -across / 2; u <= across / 2; u += 0.9) for (let v = 0; v <= up; v += ny ? 1.4 : 1.6) {
          let x, y, z;
          if (ny) { x = u; y = floor - h; z = v - gft.d / 2; } else {
            y = floor - v;
            if (nz) { x = u; z = (nz * gft.d) / 2; } else { x = (nx * gft.w) / 2; z = u; }
          }
          const wx = x + gft.x, wz = z + gft.z, rx = wx * cr + wz * sr, rz = wz * cr - wx * sr;
          const ribbon = Math.abs(u) < 1.4 || (ny ? Math.abs(z) < 1.4 : Math.abs(y - (floor - h / 2)) < 1.2);
          const k = ny ? 1 : 0.78 + 0.22 * nzv, c = ribbon ? gft.rib : gft.col;
          put(cx + rx, row(y, rz), rz + (ribbon ? 0.2 : 0), ribbon ? "#" : "%@%#"[(Math.round(u) + Math.round(v)) & 3], c[0] * k, c[1] * k, c[2] * k);
        }
      }
      if (grow >= 1) {                               // a bow on the lid
        const rx = gft.x * cr + gft.z * sr, rz = gft.z * cr - gft.x * sr, by = row(floor - h - 0.8, rz);
        for (const [dx, dy, ch] of [[-2, 0, "("], [-1, -1, "@"], [-1, 0, "@"], [0, 0, "#"], [1, -1, "@"], [1, 0, "@"], [2, 0, ")"]]) put(cx + rx + dx, by + dy, rz + 2, ch, ...gft.rib);
      }
    }
    const pal = LIGHTS[this.opts.lights] || LIGHTS.warm;
    for (const p of this.lights) {
      if (age < p.birth) continue;
      const ux = sx(p), uz = sz(p), z = uz * p.r + 1, x = cx + ux * p.r, y = row(p.y, z);
      let b = REDUCED ? 1 : 0.7 + 0.5 * Math.sin(t * 2 + p.ph) ** 2;
      const d = Math.hypot(x - this.px, (y - this.py) * ASPECT);
      if (d < 10) b = Math.min(1.5, b + (10 - d) / 10);
      b = (b + this.flash * 0.6) * (0.6 + 0.4 * (uz + 1) / 2);
      const c = pal[p.k % pal.length];
      put(x, y, z, b > 0.95 ? "@" : "o", Math.min(255, c[0] * b), Math.min(255, c[1] * b), Math.min(255, c[2] * b));
    }
    if (age > 7.4) {                                 // the star lights up last
      const on = smooth((age - 7.4) / 0.4), fl = Math.max(0, 1 - (age - 7.4) / 1.2) ** 2, pulse = 0.88 + 0.12 * Math.sin(t * 2.4);
      const sy = top - 2.5, outer = 6 * on, inner = 2.5 * on;
      const vx = [], vy = [];
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? inner : outer; vx.push(Math.cos(a) * r); vy.push(Math.sin(a) * r); }
      const inside = (x, y) => { let hit = false; for (let i = 0, j = 9; i < 10; j = i++) if ((vy[i] > y) !== (vy[j] > y) && x < ((vx[j] - vx[i]) * (y - vy[i])) / (vy[j] - vy[i]) + vx[i]) hit = !hit; return hit; };
      const gold = [255, 215, 110].map((v) => (v + (255 - v) * fl) * pulse);
      for (let dy = -5; dy <= 5; dy++) for (let dx = -7; dx <= 7; dx++) if (inside(dx, dy * ASPECT * 0.9)) G.set(cx + dx, sy + dy, C[Math.abs(dx) < 3 && Math.abs(dy) < 2 ? "@" : "*"], ...gold);
      for (let ray = 0; ray < 8; ray++) {
        const a = (ray * Math.PI) / 4, ext = ray % 2 ? 11 : 16, ch = ["-", "\\", "|", "/"][ray % 4];
        for (let dist = 8; dist < ext; dist += 1) { const f = (1 - dist / ext) * on * (0.7 + 0.3 * fl); G.set(cx + Math.cos(a) * dist, sy + (Math.sin(a) * dist) / ASPECT, C[ch], 255 * f, 220 * f, 130 * f); }
      }
    }
    for (const s of this.sparks) {
      const k = Math.min(1, s.life);
      G.set(s.x, s.y, C[k > 0.6 ? "*" : "."], 255 * k, 225 * k, 140 * k);
    }
  }
}

// ---------------------------------------------------------------- Fireplace
// A crackling fire in a brick hearth with stockings on the mantel. Move over the fire to
// blow on the embers; click for a burst of sparks.
class Fireplace {
  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    this.x0 = Math.round(cols * 0.24); this.x1 = Math.round(cols * 0.76);
    this.y0 = Math.round(rows * 0.34); this.y1 = Math.round(rows * 0.86);
    this.fw = this.x1 - this.x0; this.fh = this.y1 - this.y0;
    this.heat = new Float32Array(this.fw * this.fh);
    this.sparks = []; this.px = -999; this.py = -999; this.blow = 0;
  }
  pointer(x, y, kind) {
    if (x > this.x0 && x < this.x1 && y > this.y0 - 4 && y < this.y1 + 2) { this.blow = 1; this.bx = x; }
    this.px = x; this.py = y;
    if (kind === "down") for (let i = 0; i < (REDUCED ? 15 : 70); i++) {
      this.sparks.push({ x: rand(this.x0 + 4, this.x1 - 4), y: this.y1 - 3, vx: rand(-3, 3), vy: rand(-16, -6), life: rand(0.8, 2) });
    }
  }
  step(dt, t) {
    const { fw, fh, heat } = this;
    this.blow = Math.max(0, this.blow - dt * 1.2);
    for (let x = 0; x < fw; x++) {                   // fuel along the logs
      const edge = Math.min(x, fw - 1 - x) / (fw * 0.18);
      let fuel = clamp(edge, 0, 1) * (0.75 + 0.25 * Math.random());
      if (this.blow > 0 && Math.abs(this.x0 + x - this.bx) < 8) fuel = Math.min(1.25, fuel + 0.5 * this.blow);
      heat[(fh - 1) * fw + x] = fuel;
    }
    const cool = 1.9 / fh;                          // heat rises, wanders, cools
    for (let y = 0; y < fh - 1; y++) for (let x = 0; x < fw; x++) {
      const src = (y + 1) * fw + clamp(x + ((Math.random() * 3) | 0) - 1, 0, fw - 1);
      heat[y * fw + x] = Math.max(0, heat[src] - Math.random() * cool * 1.6);
    }
    if (!REDUCED && Math.random() < dt * 3) this.sparks.push({ x: rand(this.x0 + 6, this.x1 - 6), y: this.y1 - 4, vx: rand(-1, 1), vy: rand(-9, -4), life: rand(0.6, 1.4) });
    for (const s of this.sparks) { s.x += (s.vx + Math.sin(t * 7 + s.y) * 1.5) * dt; s.y += s.vy * dt; s.life -= dt; }
    this.sparks = this.sparks.filter((s) => s.life > 0);
    let sum = 0; for (let x = 0; x < fw; x++) sum += heat[(fh - 6) * fw + x];
    this.glow = sum / fw;
  }
  draw(G, C, t) {
    const { cols, rows, x0, x1, y0, y1, fw, fh, heat } = this;
    const glow = 0.35 + 0.65 * (this.glow || 0.5);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {   // brick wall, lit by the fire
      const i = y * cols + x;
      const d = Math.hypot((x - (x0 + x1) / 2) / cols, (y - y1) / rows * 0.8);
      const lit = glow * Math.max(0.12, 1 - d * 1.9);
      const mortar = y % 3 === 0 || (x + (((y / 3) | 0) % 2) * 4) % 8 === 0;
      G.set(x, y, C[mortar ? (y % 3 === 0 ? "_" : "|") : hash(x, y) > 0.5 ? "#" : "="], (mortar ? 70 : 150) * lit, (mortar ? 45 : 55) * lit, (mortar ? 35 : 40) * lit);
    }
    for (let x = x0 - 4; x <= x1 + 4; x++) for (const [dy, ch] of [[-2, "="], [-1, "_"]]) G.set(x, y0 + dy, C[ch], 170 * glow, 110 * glow, 70 * glow);   // mantel
    const stocking = (sx, col) => {                  // stockings hanging from the mantel
      const rowsS = [[0, "=", [240, 240, 240]], [1, "#", col], [2, "#", col], [3, "#", col]];
      for (const [dy, ch, c] of rowsS) for (let dx = 0; dx < 3; dx++) G.set(sx + dx, y0 + dy, C[ch], ...c);
      G.set(sx + 1, y0 + 4, C["#"], ...col); G.set(sx + 2, y0 + 4, C["#"], ...col); G.set(sx + 3, y0 + 4, C["_"], ...col); G.set(sx + 4, y0 + 4, C["/"], ...col);
    };
    const n = Math.max(2, Math.floor(fw / 14));
    for (let k = 0; k < n; k++) stocking(x0 + 3 + Math.round((k * (fw - 8)) / Math.max(1, n - 1)) - (k === n - 1 ? 3 : 0), [[200, 40, 50], [40, 140, 80], [200, 40, 50], [40, 90, 190]][k % 4]);
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {   // the fire itself
      const h = heat[y * fw + x], i = (y0 + y + 5) * cols + x0 + x;
      if (y0 + y + 5 >= y1) continue;
      const r = clamp(h * 3, 0, 1), g = clamp(h * 3 - 1, 0, 1), b = clamp(h * 3 - 2, 0, 1);
      if (h < 0.08) { G.r[i] = 0; G.g[i] = 0; G.b[i] = 0; G.code[i] = C[" "]; continue; }
      G.r[i] = 255 * r; G.g[i] = 200 * g + 30 * r; G.b[i] = 140 * b;
      G.code[i] = C[h < 0.16 ? "." : h < 0.26 ? ":" : h < 0.38 ? "+" : h < 0.5 ? "*" : h < 0.66 ? "%" : h < 0.82 ? "#" : "@"];
    }
    for (let x = x0 + 2; x < x1 - 2; x++) {          // logs
      G.set(x, y1 - 1, C[(x - x0) % 9 === 0 ? ")" : "="], 110, 60, 30);
      if ((x - x0) % 13 > 3) G.set(x, y1 - 2, C[(x - x0) % 13 === 4 ? "(" : "="], 95, 50, 25);
    }
    for (let x = x0 - 6; x <= x1 + 6; x++) G.set(x, y1, C["_"], 120 * glow, 80 * glow, 60 * glow);
    for (const s of this.sparks) { const k = Math.min(1, s.life * 1.5); G.set(s.x, s.y, C[k > 0.7 ? "*" : "."], 255 * k, 170 * k, 60 * k); }
  }
}

// ---------------------------------------------------------------- Northern lights
// Aurora curtains over a snowy village. The cursor bends the lights; click and a sleigh
// streaks across the sky.
class Aurora {
  resize(cols, rows) {
    this.cols = cols; this.rows = rows;
    this.px = cols / 2; this.py = rows * 0.3; this.bend = 0; this.sleigh = null;
    this.hill = Float32Array.from({ length: cols }, (_, x) => rows * (0.8 + 0.05 * Math.sin(x * 0.045) + 0.03 * Math.sin(x * 0.13 + 1)));
    this.houses = [];
    for (let x = 8; x < cols - 10; x += Math.round(rand(14, 26))) this.houses.push({ x, w: Math.round(rand(5, 8)), lit: Math.random() });
    this.pines = Array.from({ length: Math.round(cols / 9) }, () => ({ x: Math.round(rand(2, cols - 2)), h: Math.round(rand(2, 5)) }));
  }
  pointer(x, y, kind) {
    this.px = x; this.py = y; this.bend = 1;
    if (kind === "down" && !this.sleigh) this.sleigh = { x: this.cols + 10, y: rand(this.rows * 0.15, this.rows * 0.4), trail: [] };
  }
  step(dt) {
    this.bend = Math.max(0, this.bend - dt * 0.3);
    const s = this.sleigh;
    if (s) {
      s.x -= dt * (REDUCED ? 18 : 34); s.y += Math.sin(s.x * 0.08) * dt * 2;
      s.trail.push([s.x + 9, s.y, 1]);
      for (const p of s.trail) p[2] -= dt * 0.8;
      s.trail = s.trail.filter((p) => p[2] > 0);
      if (s.x < -30 && !s.trail.length) this.sleigh = null;
    }
  }
  draw(G, C, t) {
    const { cols, rows } = this;
    nightSky(G, C, cols, rows, t, 0.75);
    const speed = REDUCED ? 0.4 : 1;
    const bands = [[0.22, 0.9, [60, 255, 150]], [0.3, 0.7, [60, 220, 210]], [0.17, 0.55, [170, 90, 255]]];
    for (let b = 0; b < bands.length; b++) {
      const [base, power, col] = bands[b];
      for (let x = 0; x < cols; x++) {
        const k = x / cols;
        const lean = this.bend * Math.exp(-(((x - this.px) / 18) ** 2)) * (this.py - rows * base) * 0.5;
        const yc = rows * base + Math.sin(k * 7 + t * 0.25 * speed + b * 2) * rows * 0.06 + Math.sin(k * 17 - t * 0.4 * speed + b) * rows * 0.025 + lean;
        const len = rows * (0.12 + 0.1 * (0.5 + 0.5 * Math.sin(k * 11 + t * 0.3 * speed + b * 4)));
        const shimmer = 0.6 + 0.4 * Math.sin(k * 40 + t * 2 * speed + b);
        for (let j = 0; j < len; j++) {
          const y = Math.round(yc + j);
          if (y < 0 || y >= rows) continue;
          const f = (1 - j / len) ** 1.4 * power * shimmer;
          const i = y * cols + x;
          G.r[i] += col[0] * f * 0.8; G.g[i] += col[1] * f * 0.8; G.b[i] += col[2] * f * 0.8;
          G.code[i] = C[f > 0.55 ? "|" : f > 0.3 ? "!" : f > 0.12 ? ":" : "."];
        }
      }
    }
    for (let x = 0; x < cols; x++) {                 // snowy hills
      const h = Math.round(this.hill[x]);
      for (let y = h; y < rows; y++) G.set(x, y, C[y === h ? "_" : hash(x, y) > 0.86 ? "." : " "], 150, 170, 205);
    }
    for (const p of this.pines) {
      const g = Math.round(this.hill[p.x]);
      for (let k = 0; k < p.h; k++) for (let dx = -k; dx <= k; dx++) G.set(p.x + dx, g - p.h + k, C[dx === -k ? "/" : dx === k ? "\\" : "^"], 30, 80, 55);
    }
    for (const hs of this.houses) {                  // little houses with warm windows
      const g = Math.round(Math.min(this.hill[hs.x], this.hill[Math.min(cols - 1, hs.x + hs.w)]));
      for (let x = 0; x < hs.w; x++) {
        G.set(hs.x + x, g - 3, C["_"], 220, 225, 240);
        G.set(hs.x + x, g - 1, C[x === 0 || x === hs.w - 1 ? "|" : "_"], 120, 90, 80);
        G.set(hs.x + x, g - 2, C[x === 0 || x === hs.w - 1 ? "|" : " "], 120, 90, 80);
      }
      G.set(hs.x - 1, g - 3, C["/"], 220, 225, 240); G.set(hs.x + hs.w, g - 3, C["\\"], 220, 225, 240);
      const flick = 0.85 + 0.15 * Math.sin(t * 3 + hs.lit * 20);
      if (hs.lit > 0.2) { G.set(hs.x + 1, g - 2, C["#"], 255 * flick, 200 * flick, 90 * flick); G.set(hs.x + hs.w - 2, g - 2, C["#"], 255 * flick, 190 * flick, 80 * flick); }
    }
    const s = this.sleigh;
    if (s) {
      for (const [x, y, k] of s.trail) G.set(x, y, C[k > 0.6 ? "*" : "."], 255 * k, 225 * k, 150 * k);
      const shape = [[0, "\\"], [1, "_"], [2, "_"], [3, "/"], [-3, "-"], [-5, "-"], [-7, "^"], [-9, "^"]];
      for (const [dx, ch] of shape) G.set(s.x + dx + 4, s.y, C[ch], 230, 215, 190);
    }
  }
}

export const SCENES = {
  water: { name: "Water", hint: "Click to drop a stone. Move to make a wake.", make: (o) => new Water(o), glow: 0.35, style: { contrast: 1 } },
  butterflies: { name: "Butterflies", hint: "They flee your cursor. Click to scare them.", make: () => new Butterflies(), glow: 0.5 },
  fireflies: { name: "Fireflies", hint: "They gather around your cursor. Click to make them flash.", make: () => new Fireflies(), glow: 0.9 },
  rain: { name: "Rain", hint: "Move through the rain. Click for a shockwave.", make: (o) => new Rain(o), glow: 0.6 },
  stars: { name: "Starfield", hint: "Steer with your cursor. Click to jump to hyperspace.", make: () => new Stars(), glow: 0.6 },
  snow: { name: "Snowfall", hint: "Your cursor is warm: snow swirls round it. Click for a gust.", make: (o) => new Snow(o), glow: 0.5, season: "christmas" },
  tree: { name: "Christmas tree", hint: "Move sideways to spin it. Click to shake the branches.", make: (o) => new Tree(o), glow: 0.75, cell: 5.5, season: "christmas" },
  fireplace: { name: "Fireplace", hint: "Move over the fire to blow on it. Click for sparks.", make: () => new Fireplace(), glow: 0.9, season: "christmas" },
  aurora: { name: "Northern lights", hint: "The lights bend toward you. Click the sky.", make: () => new Aurora(), glow: 0.7, season: "christmas" },
};
