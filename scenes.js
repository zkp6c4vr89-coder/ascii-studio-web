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

export const SCENES = {
  water: { name: "Water", hint: "Click to drop a stone. Move to make a wake.", make: (o) => new Water(o), glow: 0.35, style: { contrast: 1 } },
  butterflies: { name: "Butterflies", hint: "They flee your cursor. Click to scare them.", make: () => new Butterflies(), glow: 0.5 },
  fireflies: { name: "Fireflies", hint: "They gather around your cursor. Click to make them flash.", make: () => new Fireflies(), glow: 0.9 },
  rain: { name: "Rain", hint: "Move through the rain. Click for a shockwave.", make: (o) => new Rain(o), glow: 0.6 },
  stars: { name: "Starfield", hint: "Steer with your cursor. Click to jump to hyperspace.", make: () => new Stars(), glow: 0.6 },
};
