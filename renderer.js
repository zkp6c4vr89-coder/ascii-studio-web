// ASCII Studio renderer (WebGL2). Same recipe as desktop/ascii_core.py:
//   grid pass   : average the source inside every character cell
//   glyph pass  : brightness -> character (by ink), edges -> | / - \ _, colour, stamp glyph
//   glow passes : quarter-res blur added on top

const RAMP_CANDIDATES = " .`',:;~-+=*!ir1lcvxzjtfoeasun0{}[]<>?%$#&8B@QWM";
const EDGE_CHARS = "|/-\\_";
const EXTRA_CHARS = "()^VY";      // extra shapes the interactive scenes use
const FONT = 'Menlo, "SF Mono", Consolas, "DejaVu Sans Mono", monospace';
export const STYLES = ["colour", "matrix", "mono"];

const VERT = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1,-1), vec2(3,-1), vec2(-1,3));
void main() { gl_Position = vec4(P[gl_VertexID], 0, 1); }`;

const COMMON = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

const GRID_FRAG = COMMON + `
uniform sampler2D uSrc;
uniform vec2 uGrid;        // cols, rows
uniform vec4 uXform;       // uv scale.xy, offset.zw (cover fit + mirror)
uniform int uMode;         // 0 source, 1 rain
uniform float uTime;
uniform float uPeriod;     // everything repeats exactly every uPeriod seconds (seamless loops)
void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  if (uMode == 1) {
    float rowTop = uGrid.y - 1.0 - cell.y;
    vec3 c = vec3(0);
    for (int k = 0; k < 2; k++) {
      float seed = cell.x + float(k) * 97.0;
      float speed = 5.0 + hash(vec2(seed, 1.0)) * 14.0;
      float len = 6.0 + hash(vec2(seed, 7.0)) * 26.0;
      // spacing between drops is stretched so each column repeats exactly once per loop
      float cyc = max(1.0, floor(speed * uPeriod / (uGrid.y + len + 30.0)));
      float total = speed * uPeriod / cyc;
      float head = mod(uTime * speed + hash(vec2(seed, 3.0)) * total, total);
      float d = head - rowTop;
      float b = (d >= 0.0 && d < len) ? pow(1.0 - d / len, 1.6) : 0.0;
      c = max(c, vec3(0.25, 1.0, 0.35) * b + ((d >= 0.0 && d < 1.0) ? vec3(0.7) : vec3(0)));
    }
    o = vec4(c, 1);
    return;
  }
  vec3 acc = vec3(0);
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    vec2 uv = (cell + (vec2(i, j) + 0.5) / 4.0) / uGrid;
    uv.y = 1.0 - uv.y;                       // images are stored top row first
    acc += texture(uSrc, uv * uXform.xy + uXform.zw).rgb;
  }
  o = vec4(acc / 16.0, 1);
}`;

const GLYPH_FRAG = COMMON + `
uniform sampler2D uGridTex;
uniform sampler2D uAtlas;
uniform sampler2D uLut;
uniform ivec2 uGridSize;
uniform ivec2 uCell;
uniform vec2 uOrigin;
uniform float uEdgeBase, uContrast, uGamma, uSat, uEdgeT, uJitter, uTime, uPeriod, uFps;
const float TAU = 6.2831853;
uniform int uStyle, uEdges, uDirect;
float L(ivec2 c) {
  c = clamp(c, ivec2(0), uGridSize - 1);
  float l = dot(texelFetch(uGridTex, c, 0).rgb, vec3(0.299, 0.587, 0.114));
  return pow(clamp((l - 0.5) * uContrast + 0.5, 0.0, 1.0), uGamma);
}
void main() {
  ivec2 p = ivec2(floor(gl_FragCoord.xy - uOrigin));
  ivec2 c = p / uCell;
  if (p.x < 0 || p.y < 0 || c.x >= uGridSize.x || c.y >= uGridSize.y) { o = vec4(0, 0, 0, 1); return; }
  ivec2 local = p - c * uCell;
  if (uDirect == 1) {
    // Direct mode (interactive scenes): rgb = colour, alpha = character index,
    // or 255 = "pick a character by brightness". Rows are stored top first.
    vec4 d = texelFetch(uGridTex, ivec2(c.x, uGridSize.y - 1 - c.y), 0);
    float code = floor(d.a * 255.0 + 0.5);
    vec3 col = d.rgb;
    float di = code;
    if (code > 254.5) {
      float lb = max(col.r, max(col.g, col.b));
      di = floor(texture(uLut, vec2((lb * 255.0 + 0.5) / 256.0, 0.5)).r * 255.0 + 0.5);
      col = col / max(lb, 1e-3) * (0.3 + 0.7 * lb);
    }
    float dm = texelFetch(uAtlas, ivec2(int(di) * uCell.x + local.x, uCell.y - 1 - local.y), 0).r;
    o = vec4(dm * col, 1);
    return;
  }
  vec3 s = texelFetch(uGridTex, c, 0).rgb;
  float l = L(c);
  float h = hash(vec2(c));
  // Shimmer: whole numbers of waves and re-rolls per loop, so a recording loops seamlessly.
  // Faster character speed (uFps) = more changes per second.
  if (uJitter > 0.0) {
    float n = 1.0 + floor(uPeriod * (0.15 + 0.5 * h) * uFps / 12.0);
    l = clamp(l + uJitter * 0.1 * sin(TAU * n * uTime / uPeriod + h * TAU), 0.0, 1.0);
  }
  float idx = floor(texture(uLut, vec2((l * 255.0 + 0.5) / 256.0, 0.5)).r * 255.0 + 0.5);
  if (uJitter > 0.0 && idx > 0.0) {
    float steps = max(1.0, floor(uPeriod * uFps * (0.04 + 0.2 * h) + 0.5));
    float r = hash(vec2(c) + mod(floor(uTime / uPeriod * steps), steps) * 1.37);
    if (r < uJitter * 0.25) idx = clamp(idx + (r < uJitter * 0.125 ? -1.0 : 1.0), 1.0, uEdgeBase - 1.0);
  }
  if (uEdges == 1) {
    // Sobel, written in screen-down coordinates to match the Python version
    float tl = L(c + ivec2(-1, 1)), t = L(c + ivec2(0, 1)), tr = L(c + ivec2(1, 1));
    float lf = L(c + ivec2(-1, 0)), rt = L(c + ivec2(1, 0));
    float bl = L(c + ivec2(-1, -1)), b = L(c + ivec2(0, -1)), br = L(c + ivec2(1, -1));
    float gx = (tr + 2.0 * rt + br) - (tl + 2.0 * lf + bl);
    float gy = (bl + 2.0 * b + br) - (tl + 2.0 * t + tr);
    if (length(vec2(gx, gy)) > uEdgeT * 2.0 && l > 0.12) {
      float a = mod(degrees(atan(gy, gx)), 180.0);
      float e = 0.0;                                   // |
      if (a >= 22.5 && a < 67.5) e = 1.0;              // /
      else if (a >= 67.5 && a < 112.5) e = gy < 0.0 ? 4.0 : 2.0;   // _ or -
      else if (a >= 112.5 && a < 157.5) e = 3.0;       // backslash
      idx = uEdgeBase + e;
    }
  }
  float m = texelFetch(uAtlas, ivec2(int(idx) * uCell.x + local.x, uCell.y - 1 - local.y), 0).r;
  vec3 col;
  if (uStyle == 1) col = (0.25 + 0.75 * l) * vec3(0.25, 1.0, 0.35) + pow(l, 4.0) * vec3(0.6, 0.0, 0.55);
  else if (uStyle == 2) col = vec3(0.35 + 0.65 * l);
  else {
    float g = (s.r + s.g + s.b) / 3.0;
    vec3 v = clamp(g + (s - g) * uSat, 0.0, 1.0);
    col = v / max(max(v.r, max(v.g, v.b)), 1e-3) * (0.3 + 0.7 * l);
  }
  o = vec4(m * col, 1);
}`;

const BLUR_FRAG = COMMON + `
uniform sampler2D uTex;
uniform vec2 uDir;      // one texel step in the source, in uv
uniform vec2 uOutSize;
void main() {
  vec2 uv = gl_FragCoord.xy / uOutSize;
  float w[5] = float[5](0.227, 0.194, 0.122, 0.054, 0.016);
  vec3 a = texture(uTex, uv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    a += texture(uTex, uv + uDir * float(i)).rgb * w[i];
    a += texture(uTex, uv - uDir * float(i)).rgb * w[i];
  }
  o = vec4(a, 1);
}`;

const COMPOSITE_FRAG = COMMON + `
uniform sampler2D uArt;
uniform sampler2D uGlow;
uniform vec2 uSize;
uniform float uGlowAmt;
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  o = vec4(clamp(texture(uArt, uv).rgb + texture(uGlow, uv).rgb * uGlowAmt, 0.0, 1.0), 1);
}`;

export const DEFAULTS = {
  cell: 8, style: "colour", contrast: 1.25, gamma: 0.9, saturation: 1.35,
  edges: true, edgeThreshold: 0.45, glow: 0.45, shimmer: 0, mirror: false, mode: "source",
  fps: 24,       // character speed: how many times per second characters may change
  period: 10,    // seconds after which the animation repeats exactly (= recording length)
};

export class AsciiRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false, alpha: false });
    if (!gl) throw new Error("WebGL2 isn't available in this browser.");
    this.gl = gl;
    this.settings = { ...DEFAULTS };
    this.source = null;
    this.progs = {
      grid: this._program(GRID_FRAG), glyph: this._program(GLYPH_FRAG),
      blur: this._program(BLUR_FRAG), comp: this._program(COMPOSITE_FRAG),
    };
    this.vao = gl.createVertexArray();
    this.srcTex = this._texture(gl.LINEAR);
    this.lutTex = this._texture(gl.NEAREST);
    this.atlasTex = this._texture(gl.NEAREST);
    this.targets = {};
    this.atlasKey = "";
  }

  // ---------- setup helpers ----------
  _program(frag) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const loc = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      loc[name] = gl.getUniformLocation(p, name);
    }
    return { p, loc };
  }

  _texture(filter) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _target(name, w, h, filter) {
    const gl = this.gl;
    let t = this.targets[name];
    if (t && t.w === w && t.h === h) return t;
    if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    const tex = this._texture(filter);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    t = this.targets[name] = { tex, fbo, w, h };
    return t;
  }

  get cellW() { return Math.max(3, Math.round(this.settings.cell)); }
  get cellH() { return Math.round(this.cellW * 1.75); }

  // Draws every character once, sorts the ramp by measured ink, builds the brightness LUT.
  _buildAtlas() {
    const cw = this.cellW, ch = this.cellH;
    const key = `${cw}x${ch}`;
    if (key === this.atlasKey) return;
    this.atlasKey = key;
    const size = Math.max(6, Math.floor(Math.min(ch * 0.92, cw / 0.602)));
    const draw = (chars) => {
      const c = document.createElement("canvas");
      c.width = cw * chars.length; c.height = ch;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.fillStyle = "#000"; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = "#fff"; x.font = `${size}px ${FONT}`;
      x.textAlign = "center"; x.textBaseline = "middle";
      [...chars].forEach((k, i) => x.fillText(k, i * cw + cw / 2, ch / 2 + size * 0.05));
      return c;
    };
    const uniq = [...new Set(RAMP_CANDIDATES)];
    const probe = draw(uniq.join("")).getContext("2d").getImageData(0, 0, cw * uniq.length, ch).data;
    const inkOf = (i) => {
      let s = 0;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) s += probe[(y * cw * uniq.length + i * cw + x) * 4];
      return s / (cw * ch * 255);
    };
    const sorted = uniq.map((k, i) => [k, inkOf(i)]).sort((a, b) => a[1] - b[1]);
    this.ramp = sorted.map((s) => s[0]).join("");
    this.chars = this.ramp + EDGE_CHARS + [...EXTRA_CHARS].filter((k) => !this.ramp.includes(k)).join("");
    this.charIndex = {};
    [...this.chars].forEach((k, i) => { if (!(k in this.charIndex)) this.charIndex[k] = i; });
    const lo = sorted[0][1], hi = sorted[sorted.length - 1][1];
    const ink = sorted.map((s) => (s[1] - lo) / Math.max(hi - lo, 1e-6));
    this.lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      let best = 0;
      for (let i = 1; i < ink.length; i++) if (Math.abs(ink[i] - v / 255) < Math.abs(ink[best] - v / 255)) best = i;
      this.lut[v] = best;
    }
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 1, 0, gl.RED, gl.UNSIGNED_BYTE, this.lut);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, draw(this.chars));
  }

  // ---------- public API ----------
  setSource(el) { this.source = el; this._srcUploaded = false; }

  sourceSize() {
    const s = this.source;
    if (!s) return null;
    const w = s.videoWidth || s.naturalWidth || s.width, h = s.videoHeight || s.naturalHeight || s.height;
    return w && h ? [w, h] : null;
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  // Character grid that fits the canvas right now, and a char -> index map for direct mode.
  gridSize() {
    this._buildAtlas();
    return [Math.max(1, Math.floor(this.canvas.width / this.cellW)), Math.max(1, Math.floor(this.canvas.height / this.cellH))];
  }
  charMap() { this._buildAtlas(); return this.charIndex; }

  // Draw a grid supplied by the caller: Uint8Array of cols*rows*4, rows top first,
  // rgb = colour, a = character index (or 255 = choose a character by brightness).
  renderDirect(buf, timeSec = performance.now() / 1000) {
    this._directBuf = buf;
    try { return this.render(timeSec); } finally { this._directBuf = null; }
  }

  render(timeSec = performance.now() / 1000) {
    const gl = this.gl, s = this.settings;
    const W = this.canvas.width, H = this.canvas.height;
    this._buildAtlas();
    const cw = this.cellW, ch = this.cellH;
    const cols = Math.max(1, Math.floor(W / cw)), rows = Math.max(1, Math.floor(H / ch));
    const direct = this._directBuf;
    const rain = s.mode === "rain" && !direct;
    gl.bindVertexArray(this.vao);

    // upload the current frame
    let xform = [1, 1, 0, 0];
    if (!rain && !direct) {
      const size = this.sourceSize();
      if (!size) return false;
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      const isStill = this.source instanceof HTMLImageElement;
      if (!isStill || !this._srcUploaded) {
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.source);
        this._srcUploaded = true;
      }
      // cover-fit the source into the art area
      const srcA = size[0] / size[1], dstA = (cols * cw) / (rows * ch);
      let sx = 1, sy = 1;
      if (srcA > dstA) sx = dstA / srcA; else sy = srcA / dstA;
      xform = [sx, sy, (1 - sx) / 2, (1 - sy) / 2];
      if (s.mirror) { xform[0] = -sx; xform[2] = 1 - (1 - sx) / 2; }
    }

    // 1. grid pass
    const grid = this._target("grid", cols, rows, gl.NEAREST);
    let P;
    if (direct) {
      if (direct.length !== cols * rows * 4) return false;   // grid changed size; caller re-sizes
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, grid.tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, direct);
    } else {
      P = this.progs.grid;
      gl.useProgram(P.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, grid.fbo);
      gl.viewport(0, 0, cols, rows);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.uniform1i(P.loc.uSrc, 0);
      gl.uniform2f(P.loc.uGrid, cols, rows);
      gl.uniform4f(P.loc.uXform, ...xform);
      gl.uniform1i(P.loc.uMode, rain ? 1 : 0);
      gl.uniform1f(P.loc.uTime, timeSec);
      gl.uniform1f(P.loc.uPeriod, s.period);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    this.lastGrid = { cols, rows };

    // 2. glyph pass
    const glow = s.glow > 0.001;
    const art = this._target("art", W, H, gl.LINEAR);
    P = this.progs.glyph;
    gl.useProgram(P.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, glow ? art.fbo : null);
    gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, grid.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.uniform1i(P.loc.uGridTex, 0); gl.uniform1i(P.loc.uAtlas, 1); gl.uniform1i(P.loc.uLut, 2);
    gl.uniform2i(P.loc.uGridSize, cols, rows);
    gl.uniform2i(P.loc.uCell, cw, ch);
    gl.uniform2f(P.loc.uOrigin, Math.floor((W - cols * cw) / 2), Math.floor((H - rows * ch) / 2));
    gl.uniform1f(P.loc.uEdgeBase, this.ramp.length);
    gl.uniform1f(P.loc.uContrast, rain ? 1 : s.contrast);
    gl.uniform1f(P.loc.uGamma, rain ? 1 : s.gamma);
    gl.uniform1f(P.loc.uSat, s.saturation);
    gl.uniform1f(P.loc.uEdgeT, s.edgeThreshold);
    gl.uniform1f(P.loc.uJitter, rain ? Math.max(0.8, s.shimmer) : s.shimmer);
    gl.uniform1f(P.loc.uTime, timeSec);
    gl.uniform1f(P.loc.uPeriod, s.period);
    gl.uniform1f(P.loc.uFps, s.fps);
    gl.uniform1i(P.loc.uStyle, STYLES.indexOf(s.style));
    gl.uniform1i(P.loc.uEdges, s.edges && !rain ? 1 : 0);
    gl.uniform1i(P.loc.uDirect, direct ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!glow) return true;

    // 3. glow: blur at quarter resolution, then add on top
    const qw = Math.max(1, W >> 2), qh = Math.max(1, H >> 2);
    const bA = this._target("blurA", qw, qh, gl.LINEAR), bB = this._target("blurB", qw, qh, gl.LINEAR);
    P = this.progs.blur;
    gl.useProgram(P.p);
    gl.viewport(0, 0, qw, qh);
    gl.uniform1i(P.loc.uTex, 0);
    gl.uniform2f(P.loc.uOutSize, qw, qh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bA.fbo); gl.bindTexture(gl.TEXTURE_2D, art.tex);
    gl.uniform2f(P.loc.uDir, 3 / W * 2, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bB.fbo); gl.bindTexture(gl.TEXTURE_2D, bA.tex);
    gl.uniform2f(P.loc.uDir, 0, 1.5 / qh); gl.drawArrays(gl.TRIANGLES, 0, 3);

    P = this.progs.comp;
    gl.useProgram(P.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, art.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bB.tex);
    gl.uniform1i(P.loc.uArt, 0); gl.uniform1i(P.loc.uGlow, 1);
    gl.uniform2f(P.loc.uSize, W, H);
    gl.uniform1f(P.loc.uGlowAmt, s.glow);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  // Plain-text version of the last rendered frame (no colour).
  toText() {
    const gl = this.gl, s = this.settings, g = this.targets.grid;
    if (!g || !this.lastGrid) return "";
    const { cols, rows } = this.lastGrid;
    const px = new Uint8Array(cols * rows * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.fbo);
    gl.readPixels(0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const L = (x, y) => {
      x = Math.min(cols - 1, Math.max(0, x)); y = Math.min(rows - 1, Math.max(0, y));
      const i = ((rows - 1 - y) * cols + x) * 4;   // y counts down from the top here
      const l = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
      return Math.pow(Math.min(1, Math.max(0, (l - 0.5) * s.contrast + 0.5)), s.gamma);
    };
    const lines = [];
    for (let y = 0; y < rows; y++) {
      let line = "";
      for (let x = 0; x < cols; x++) {
        const l = L(x, y);
        let ch = this.ramp[this.lut[Math.round(l * 255)]];
        if (s.edges) {
          const gx = (L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1)) - (L(x - 1, y - 1) + 2 * L(x - 1, y) + L(x - 1, y + 1));
          const gy = (L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1)) - (L(x - 1, y - 1) + 2 * L(x, y - 1) + L(x + 1, y - 1));
          if (Math.hypot(gx, gy) > s.edgeThreshold * 2 && l > 0.12) {
            const a = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180;
            ch = a < 22.5 || a >= 157.5 ? "|" : a < 67.5 ? "/" : a < 112.5 ? (gy < 0 ? "_" : "-") : "\\";
          }
        }
        line += ch;
      }
      lines.push(line.trimEnd());
    }
    return lines.join("\n");
  }
}
