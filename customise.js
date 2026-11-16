// Shared "Customise" pieces: the clock and the option controls for scenes and the clock.
// Used by the browser extension's New Tab page and the desktop app's live wallpaper.
import { WATER_DEFAULTS, RAIN_DEFAULTS } from "./scenes.js";

// ================================================================ palettes
export const WATER_COLORS = [["#1fa6ff", "Ocean"], ["#2f5bff", "Deep sea"], ["#18d6c3", "Teal"], ["#3ee07a", "Lagoon"],
  ["#b6f03c", "Lime"], ["#ffd23f", "Gold"], ["#ff7a2f", "Lava"], ["#ff5f5f", "Coral"], ["#ff6fae", "Rose"],
  ["#e44bff", "Magenta"], ["#9b7bff", "Violet"], ["#c9b6ff", "Lilac"], ["#dfe7ff", "Moonlight"], ["rainbow", "Rainbow"]];
export const RAIN_COLORS = [["#39e07a", "Matrix"], ["#9dff5a", "Lime"], ["#3fd6ff", "Cyan"], ["#2f8bff", "Blue"],
  ["#7b6bff", "Indigo"], ["#a98bff", "Violet"], ["#e44bff", "Magenta"], ["#ff6fae", "Pink"], ["#ff5f5f", "Red"],
  ["#ff8a3d", "Orange"], ["#ffb347", "Amber"], ["#ffe66b", "Lemon"], ["#e8ecff", "White"], ["rainbow", "Rainbow"]];
export const CLOCK_COLORS = [["#f4f3f8", "White"], ["#fff1d6", "Cream"], ["#ffd27a", "Gold"], ["#ffb38a", "Peach"],
  ["#ff8fb3", "Pink"], ["#ff5c5c", "Red"], ["#c3a6ff", "Lilac"], ["#9b7bff", "Violet"], ["#8fe3ff", "Ice"],
  ["#5ab8ff", "Sky"], ["#9dff9a", "Mint"], ["#c6ff6b", "Lime"], ["#9a9aa5", "Grey"], ["#1a1a1a", "Ink"], ["rainbow", "Rainbow"]];
const RAINBOW_CSS = "conic-gradient(from 90deg, #ff5f5f, #ffd23f, #3ee07a, #3fd6ff, #9b7bff, #ff6fae, #ff5f5f)";

// ================================================================ clock
const FONTS = {
  modern: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, "Segoe UI", Roboto, sans-serif',
  serif: '"New York", ui-serif, "Iowan Old Style", Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  rounded: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif',
  typewriter: '"American Typewriter", "Courier New", Courier, monospace',
  ascii: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};
export const CLOCK_DEFAULTS = {
  font: "modern", weight: 600, size: 1, color: "#f4f3f8",
  hours: "auto", seconds: false, date: "long", position: "center", panel: false,
};

// big digits drawn with "#" for the ASCII font (3 wide, 5 tall)
const GLYPHS = {
  0: ["###", "# #", "# #", "# #", "###"], 1: [" # ", "## ", " # ", " # ", "###"],
  2: ["###", "  #", "###", "#  ", "###"], 3: ["###", "  #", "###", "  #", "###"],
  4: ["# #", "# #", "###", "  #", "  #"], 5: ["###", "#  ", "###", "  #", "###"],
  6: ["###", "#  ", "###", "# #", "###"], 7: ["###", "  #", "  #", "  #", "  #"],
  8: ["###", "# #", "###", "# #", "###"], 9: ["###", "# #", "###", "  #", "###"],
  ":": [" ", "#", " ", "#", " "],
};
const asciiDigits = (text) =>
  [0, 1, 2, 3, 4].map((row) => [...text].map((ch) => (GLYPHS[ch] || ["   "])[row]).join(" ")).join("\n");
const localeUses12h = (() => {
  try { return !!new Intl.DateTimeFormat([], { hour: "numeric" }).resolvedOptions().hour12; } catch { return false; }
})();
const DATE_FORMATS = {
  long: { weekday: "long", day: "numeric", month: "long" },
  short: { weekday: "short", day: "numeric", month: "short" },
  numeric: { year: "numeric", month: "2-digit", day: "2-digit" },
};

// A clock living in `clockEl` (which holds #time-like and #date-like children).
export class Clock {
  constructor(clockEl, timeEl, dateEl, opts = {}) {
    Object.assign(this, { clockEl, timeEl, dateEl });
    this.opts = { ...CLOCK_DEFAULTS, ...opts };
    this.apply();
    this.timer = setInterval(() => this.tick(), 1000);
  }
  set(patch) { Object.assign(this.opts, patch); this.apply(); }
  reset() { this.opts = { ...CLOCK_DEFAULTS }; this.apply(); }
  apply() {
    const o = this.opts, root = document.documentElement.style;
    root.setProperty("--clock-font", FONTS[o.font] || FONTS.modern);
    root.setProperty("--clock-weight", o.weight);
    root.setProperty("--clock-scale", o.size);
    const rainbow = o.color === "rainbow";
    root.setProperty("--clock-color", rainbow ? "#f4f3f8" : o.color);
    this.clockEl.className = `clock pos-${o.position}${o.panel ? " panel glass" : ""}${rainbow ? " rainbow" : ""}`;
    this.tick();
  }
  tick() {
    const o = this.opts, now = new Date();
    const use12 = o.hours === "12" || (o.hours === "auto" && localeUses12h);
    let h = now.getHours();
    const ampm = use12 ? (h >= 12 ? "PM" : "AM") : "";
    if (use12) h = h % 12 || 12;
    const pad = (n) => String(n).padStart(2, "0");
    const text = `${use12 ? h : pad(h)}:${pad(now.getMinutes())}${o.seconds ? ":" + pad(now.getSeconds()) : ""}`;
    this.timeEl.replaceChildren(o.font === "ascii"
      ? Object.assign(document.createElement("pre"), { textContent: asciiDigits(text) })
      : document.createTextNode(text));
    if (ampm) this.timeEl.append(Object.assign(document.createElement("span"), { className: "ampm", textContent: ampm }));
    this.dateEl.hidden = o.date === "hidden";
    if (o.date !== "hidden") this.dateEl.textContent = now.toLocaleDateString([], DATE_FORMATS[o.date] || DATE_FORMATS.long);
  }
}

// ================================================================ little control builders
export function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
}
export const opt = (label, control, inline = false) =>
  el("div", { className: inline ? "opt inline" : "opt" }, el("span", { className: "opt-label", textContent: label }), control);

export function toggle(value, onchange, id) {
  const i = el("input", { type: "checkbox", className: "switch", checked: !!value });
  if (id) i.id = id;
  i.onchange = () => onchange(i.checked);
  return i;
}
export function slider(min, max, step, value, fmt, oninput) {
  const i = el("input", { type: "range", min, max, step, value });
  const out = el("output");
  const sync = () => {
    out.textContent = fmt(+i.value);
    i.style.setProperty("--p", `${((i.value - min) / (max - min)) * 100}%`);
  };
  i.oninput = () => { sync(); oninput(+i.value); };
  sync();
  return el("div", { className: "slider" }, i, out);
}
export function seg(options, value, onchange) {
  const w = el("div", { className: "seg" });
  for (const [v, label] of options) {
    const b = el("button", { textContent: label, className: String(v) === String(value) ? "on" : "" });
    b.onclick = () => {
      w.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      onchange(v);
    };
    w.append(b);
  }
  return w;
}
export function swatches(colors, value, onchange) {
  const w = el("div", { className: "swatches" });
  const custom = el("input", { type: "color", title: "Any colour you like", value: /^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff" });
  const mark = (v) => w.querySelectorAll(".sw").forEach((s) => s.classList.toggle("on", s.dataset.v.toLowerCase() === String(v).toLowerCase()));
  for (const [v, name] of colors) {
    const b = el("button", { className: "sw", title: name, ariaLabel: name });
    b.dataset.v = v;
    b.style.background = v === "rainbow" ? RAINBOW_CSS : v;
    b.onclick = () => { mark(v); if (v !== "rainbow") custom.value = v; onchange(v); };
    w.append(b);
  }
  custom.oninput = () => { mark(custom.value); onchange(custom.value); };
  w.append(custom);
  mark(value);
  return w;
}

// ================================================================ option panels
// Controls for one scene. `opts` = the saved options for that scene, `set(patch)` saves + applies.
// `hover` = only mouse movement reaches the scene (desktop wallpaper), so skip click-only wording.
export function sceneControls(sceneId, opts, set, { hover = false } = {}) {
  if (sceneId === "water") {
    const o = { ...WATER_DEFAULTS, ...opts };
    return [
      opt("Ripple colour", swatches(WATER_COLORS, o.color, (v) => set({ color: v }))),
      opt("Ripple size", slider(0.5, 2, 0.1, o.size, (v) => `${Math.round(v * 100)}%`, (v) => set({ size: v }))),
      opt("Raindrops on their own", toggle(o.raindrops, (v) => set({ raindrops: v })), true),
    ];
  }
  if (sceneId === "rain") {
    const o = { ...RAIN_DEFAULTS, ...opts };
    const strength = opt("Flow strength", slider(0.4, 2, 0.1, o.strength, (v) => `${Math.round(v * 100)}%`, (v) => set({ strength: v })));
    strength.hidden = !o.fluid;
    return [
      opt("Umbrella around the cursor", toggle(o.umbrella, (v) => set({ umbrella: v })), true),
      opt("Rain flows around the cursor", toggle(o.fluid, (v) => { set({ fluid: v }); strength.hidden = !v; }), true),
      strength,
      opt("Rain colour", swatches(RAIN_COLORS, o.color, (v) => set({ color: v }))),
    ];
  }
  return [el("p", { className: "note", textContent: hover
    ? "No extra options for this one yet. Water and Rain have colours and more."
    : "No extra options for this one yet. Try Water or Rain!" })];
}

// Controls for the clock. `clock` is a Clock; `onChange(opts)` saves; `show` = [isShown, setShown].
export function clockControls(clock, onChange, [shown, setShown]) {
  const o = clock.opts;
  const set = (patch) => { clock.set(patch); onChange(clock.opts); };
  return [
    opt("Show the clock", toggle(shown, setShown, "show-clock"), true),
    opt("Font", seg([["modern", "Modern"], ["serif", "Serif"], ["mono", "Mono"], ["rounded", "Rounded"], ["typewriter", "Typewriter"], ["ascii", "ASCII"]], o.font, (v) => set({ font: v }))),
    opt("Weight", seg([[300, "Light"], [600, "Regular"], [800, "Bold"]], o.weight, (v) => set({ weight: v }))),
    opt("Size", slider(0.5, 2, 0.05, o.size, (v) => `${Math.round(v * 100)}%`, (v) => set({ size: v }))),
    opt("Colour", swatches(CLOCK_COLORS, o.color, (v) => set({ color: v }))),
    opt("Hours", seg([["auto", "Automatic"], ["12", "12-hour"], ["24", "24-hour"]], o.hours, (v) => set({ hours: v }))),
    opt("Show seconds", toggle(o.seconds, (v) => set({ seconds: v })), true),
    opt("Date", seg([["long", "Long"], ["short", "Short"], ["numeric", "Numbers"], ["hidden", "Hidden"]], o.date, (v) => set({ date: v }))),
    opt("Position", seg([["center", "Centre"], ["top-left", "Top left"], ["bottom-left", "Bottom left"]], o.position, (v) => set({ position: v }))),
    opt("Glass panel behind it", toggle(o.panel, (v) => set({ panel: v })), true),
  ];
}
