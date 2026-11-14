import { AsciiRenderer } from "./renderer.js";
import { saveWallpaper, clearWallpaper } from "./wallpaper-store.js";

const $ = (id) => document.getElementById(id);
// Only Chromium can bend the backdrop through an SVG filter (true liquid glass).
if (navigator.userAgentData && navigator.userAgentData.brands.some((b) => /Chromium/.test(b.brand))) {
  document.documentElement.classList.add("liquid");
}
const stage = $("stage"), canvas = $("out"), status = $("status");
const inExtension = /-extension:$/.test(location.protocol);
// Replace the drop-zone message. Text only (textContent), never HTML, so nothing from a
// URL or an error message can ever be interpreted as markup.
function setDrop(title, detail, button) {
  const drop = $("drop");
  const strong = Object.assign(document.createElement("strong"), { textContent: title });
  const span = Object.assign(document.createElement("span"), { textContent: detail });
  drop.replaceChildren(strong, span, ...(button ? [button] : []));
}

let renderer;
try {
  renderer = new AsciiRenderer(canvas);
} catch (e) {
  setDrop("Sorry, this browser can't run ASCII Studio", e.message);
  throw e;
}
const S = renderer.settings;

let video = null, stream = null, kind = null, objectUrl = null, currentFile = null;
let recorder = null, recTimer = null, facing = "user", lastRecording = null;
const isTouch = matchMedia("(hover: none) and (pointer: coarse)").matches;

// status messages appear as a toast, then fade away
let toastTimer;
const say = (msg) => {
  clearTimeout(toastTimer);
  status.textContent = msg;
  status.classList.toggle("show", !!msg);
  if (msg) toastTimer = setTimeout(() => status.classList.remove("show"), 4000);
};

// On phones, hand files to the share sheet (Save to Photos / Files); elsewhere, download.
async function saveBlob(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (isTouch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e.name === "AbortError") return; }   // user closed the sheet
  }
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------- sources ----------
function stopCurrent() {
  if (recorder) recorder.stop();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (video) video.pause();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  stream = video = objectUrl = currentFile = null;
  $("btn-cam").classList.remove("active");
  $("btn-flip").hidden = true;
  $("btn-rain").classList.remove("active");
}

function loadFile(file, forceVideo = false) {
  if (!file) return;
  stopCurrent();
  currentFile = file;
  objectUrl = URL.createObjectURL(file);
  S.mode = "source";
  if (forceVideo || file.type.startsWith("video/")) {
    video = Object.assign(document.createElement("video"), { src: objectUrl, loop: true, muted: true, playsInline: true });
    video.onloadeddata = () => { kind = "video"; renderer.setSource(video); stage.classList.remove("empty"); video.play(); };
    say(file.name);
  } else {
    const img = new Image();
    img.onload = () => {
      kind = "image";
      renderer.setSource(img);
      stage.classList.remove("empty");
      if (S.shimmer === 0) say(`${file.name}. Tip: raise Shimmer to make it move.`);
    };
    img.onerror = () => say("Couldn't open that image (HEIC only works in Safari).");
    img.src = objectUrl;
    say(file.name);
  }
}

async function startWebcam() {
  stopCurrent();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    say("This browser can't use the camera here (it needs HTTPS).");
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
  } catch (e) {
    say("Camera blocked: allow camera access for this site, then try again.");
    return;
  }
  video = Object.assign(document.createElement("video"), { srcObject: stream, muted: true, playsInline: true });
  video.setAttribute("playsinline", "");   // iOS: play inline, not fullscreen
  await video.play();
  kind = "webcam";
  S.mode = "source";
  const selfie = facing === "user";
  $("mirror").checked = selfie;
  S.mirror = selfie;
  renderer.setSource(video);
  stage.classList.remove("empty");
  $("btn-cam").classList.add("active");
  // offer front/back switching when the device has more than one camera
  navigator.mediaDevices.enumerateDevices().then((d) => {
    $("btn-flip").hidden = d.filter((x) => x.kind === "videoinput").length < 2;
  });
  say("Camera on.");
}

function startRain() {
  stopCurrent();
  kind = "rain";
  S.mode = "rain";
  setSeg("style", "matrix");
  S.style = "matrix";
  stage.classList.remove("empty");
  $("btn-rain").classList.add("active");
  say("Character rain.");
}

// ---------- open a URL (?src=...), used by the browser extension's right-click menu ----------
async function loadFromUrl(src, isVideo) {
  say("Loading…");
  try { src = new URL(src, location.href).href; } catch {}   // allow relative links too
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const name = decodeURIComponent(new URL(src).pathname.split("/").pop() || "media") || "media";
    loadFile(new File([blob], name, { type: blob.type }), isVideo || blob.type.startsWith("video/"));
  } catch (err) {
    const perms = globalThis.chrome && chrome.permissions;
    let origin = null;
    try { origin = new URL(src).origin; } catch {}
    if (perms && origin && origin.startsWith("http")) {
      // The site doesn't share its files with other pages; ask once for access to just this site.
      const allow = Object.assign(document.createElement("button"), {
        className: "btn primary", textContent: `Allow ${new URL(src).host}`,
      });
      setDrop(`One click to load this ${isVideo ? "video" : "image"}`,
        `ASCII Studio needs permission to read files from ${origin}`, allow);
      allow.onclick = async (e) => {
        e.preventDefault();
        if (await perms.request({ origins: [`${origin}/*`] })) loadFromUrl(src, isVideo);
      };
      say("");
    } else if (src.startsWith("blob:")) {
      say("This site streams its video in a way that can't be opened. Download it and drop it here instead.");
    } else {
      say(`Couldn't load that file (${err.message}).`);
    }
  }
}
const params = new URLSearchParams(location.search);
if (params.get("src")) loadFromUrl(params.get("src"), params.get("type") === "video");

$("btn-open").onclick = () => $("file").click();
$("file").onchange = (e) => loadFile(e.target.files[0]);
$("btn-cam").onclick = startWebcam;
$("btn-flip").onclick = () => { facing = facing === "user" ? "environment" : "user"; startWebcam(); };
$("btn-rain").onclick = startRain;
stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("dragging"); });
stage.addEventListener("dragleave", () => stage.classList.remove("dragging"));
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  stage.classList.remove("dragging");
  loadFile(e.dataTransfer.files[0]);
});

// ---------- controls ----------
// segmented controls: the thumb slides to the chosen option
function setSeg(id, v) {
  const seg = $(id), buttons = [...seg.querySelectorAll("button")];
  buttons.forEach((b) => {
    const on = b.dataset.v === v;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on);
  });
  seg.style.setProperty("--n", buttons.length);
  seg.style.setProperty("--i", Math.max(0, buttons.findIndex((b) => b.dataset.v === v)));
}
setSeg("style", "colour");
// respond on press, not on release
document.querySelectorAll("#style button").forEach((b) => (b.onpointerdown = b.onclick = () => { S.style = b.dataset.v; setSeg("style", b.dataset.v); }));

const LABELS = { cell: (v) => `${v} px`, fps: (v) => `${v}/s`, contrast: (v) => (+v).toFixed(2),
  edgeThreshold: (v) => (+v).toFixed(2), glow: (v) => (+v).toFixed(2), shimmer: (v) => (+v).toFixed(2) };
for (const id of ["cell", "contrast", "edgeThreshold", "glow", "shimmer", "fps"]) {
  const input = $(id), out = document.querySelector(`output[data-for="${id}"]`);
  const sync = () => {
    S[id] = parseFloat(input.value);
    out.textContent = LABELS[id](input.value);
    const p = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty("--p", `${p}%`);              // filled part of the track
  };
  input.oninput = sync;
  sync();
}
$("edges").onchange = (e) => (S.edges = e.target.checked);
$("mirror").onchange = (e) => (S.mirror = e.target.checked);

// ---------- loop length / recording duration ----------
function duration() {
  const on = document.querySelector("#dur button.on").dataset.v;
  const secs = on === "custom" ? parseFloat($("custom-dur").value) : parseFloat(on);
  return Math.min(120, Math.max(1, secs || 10));
}
function syncDuration() {
  S.period = duration();
  $("custom-wrap").hidden = document.querySelector("#dur button.on").dataset.v !== "custom";
  if (!recorder) $("btn-video").textContent = `● Record ${S.period}s`;
}
document.querySelectorAll("#dur button").forEach((b) => (b.onpointerdown = b.onclick = () => { setSeg("dur", b.dataset.v); syncDuration(); }));
$("custom-dur").oninput = syncDuration;
setSeg("dur", "10");
syncDuration();

// ---------- output size ----------
function outputSize() {
  const choice = $("size").value;
  if (choice === "screen") {
    const dpr = window.devicePixelRatio || 1;
    return [Math.round(screen.width * dpr), Math.round(screen.height * dpr)];
  }
  const src = kind === "rain" ? [1920, 1080] : renderer.sourceSize() || [1280, 720];
  const aspect = src[0] / src[1];
  const cap = isTouch ? 1280 : 1920;                 // keep phones fast and cool
  const h = choice === "source" ? Math.min(src[1], Math.round(cap / aspect), cap) : parseInt(choice, 10);
  const w = Math.round(h * aspect);
  return [w - (w % 2), h - (h % 2)];
}

// ---------- loop: redraw only when the character clock ticks ----------
let clockStart = performance.now() / 1000, lastTick = -1;
function frame(nowMs) {
  requestAnimationFrame(frame);
  if (!kind) return;
  const t = nowMs / 1000 - clockStart;
  const tick = Math.floor(t * S.fps);
  if (tick === lastTick) return;
  lastTick = tick;
  const [w, h] = outputSize();
  renderer.resize(w, h);
  $("size-hint").textContent = `${w} × ${h} px · ${Math.floor(w / Math.round(S.cell))} characters across`;
  const phase = ((tick / S.fps) % S.period + S.period) % S.period;   // repeats every loop
  renderer.render(phase);
}
requestAnimationFrame(frame);

// ---------- export ----------
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const needSource = () => { if (!kind) { say("Open a photo, video or webcam first."); return true; } return false; };

$("btn-png").onclick = () => {
  if (needSource()) return;
  canvas.toBlob((b) => saveBlob(b, `ascii-${stamp()}.png`), "image/png");
};
$("btn-copy").onclick = async () => {
  if (needSource()) return;
  try {
    await navigator.clipboard.writeText(renderer.toText());
    say("Copied. Paste it somewhere with a monospace font.");
  } catch {
    say("Clipboard blocked by the browser; use Save .txt instead.");
  }
};
$("btn-txt").onclick = () => {
  if (needSource()) return;
  saveBlob(new Blob([renderer.toText()], { type: "text/plain" }), `ascii-${stamp()}.txt`);
};

$("btn-save-rec").onclick = () => {
  if (!lastRecording) return;
  saveBlob(lastRecording.blob, lastRecording.name);
};

// ---------- record a loop of a chosen length ----------
function pickMime() {
  const options = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return options.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
}

$("btn-video").onclick = () => {
  if (needSource()) return;
  if (recorder) { recorder.stop(); return; }          // stop early
  $("btn-save-rec").hidden = true;
  const mime = pickMime();
  if (!mime) { say("This browser can't record video."); return; }
  const secs = S.period;
  const out = canvas.captureStream(Math.max(S.fps, 1));
  if (kind === "video" && video.captureStream) {      // keep the clip's sound (Chrome/Firefox)
    video.muted = false;
    video.captureStream().getAudioTracks().forEach((t) => out.addTrack(t));
  }
  const chunks = [];
  recorder = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => {
    clearInterval(recTimer);
    const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
    const blob = new Blob(chunks, { type: mime.split(";")[0] });
    const name = `ascii-loop-${secs}s-${stamp()}.${ext}`;
    recorder = null;
    if (video && kind === "video") video.muted = true;
    $("rec").hidden = true;
    $("btn-video").classList.remove("recording");
    syncDuration();
    if (isTouch) {
      // phones only open the share sheet from a tap, so offer a button
      lastRecording = { blob, name };
      $("btn-save-rec").hidden = false;
      say(`Your ${secs}s loop is ready. Tap Save video.`);
    } else {
      saveBlob(blob, name);
      say(`Saved a ${secs}s loop (.${ext}).`);
    }
  };
  // Start the countdown only once the recorder is really running, and restart the
  // animation clock then, so the clip is exactly one loop long and starts at its top.
  const rec = recorder;
  rec.onstart = () => {
    clockStart = performance.now() / 1000;
    lastTick = -1;
    if (kind === "video") video.currentTime = 0;
    const end = performance.now() + secs * 1000 + 100;   // +100ms so the last frame lands
    setTimeout(() => rec.state === "recording" && rec.stop(), end - performance.now());
    const tickRec = () => {
      const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
      $("rec").textContent = `● REC ${left}s`;
      $("btn-video").textContent = `■ Stop (${left}s left)`;
    };
    tickRec();
    recTimer = setInterval(tickRec, 250);
  };
  recorder.start(250);
  $("rec").textContent = "● REC";
  $("rec").hidden = false;
  $("btn-video").classList.add("recording");
  say(kind === "image" && S.shimmer === 0 ? "Recording… (raise Shimmer so the photo moves)" : "Recording…");
};

// ---------- wallpapers: browser extension (new tab) and desktop app ----------
const look = () => {
  const { style, cell, contrast, gamma, saturation, edges, edgeThreshold, glow, shimmer, fps, period, mirror } = S;
  return { style, cell, contrast, gamma, saturation, edges, edgeThreshold, glow, shimmer, fps, period, mirror };
};
// Save the current picture + look so a wallpaper page (new tab / desktop) can show it.
async function storePicture() {
  if (needSource()) return false;
  if (kind === "webcam") { say("The camera can't be a wallpaper. Use a photo, video or Rain."); return false; }
  const settings = look();
  if (kind === "image" && settings.shimmer === 0) settings.shimmer = 0.5;   // photos need a little life
  try {
    await saveWallpaper(kind === "rain"
      ? { mode: "rain", settings }
      : { mode: "source", blob: currentFile, isVideo: kind === "video", settings });
    try { localStorage.setItem("ascii-wallpaper", kind === "rain" ? "rain" : "custom"); } catch {}
    return true;
  } catch (e) {
    say(`Couldn't save the wallpaper (${e.message}).`);
    return false;
  }
}

if (inExtension) {
  $("wallpaper-group").hidden = false;
  $("btn-wall").onclick = async () => { if (await storePicture()) say("Done! Open a new tab to see it."); };
  $("btn-wall-reset").onclick = async () => {
    await clearWallpaper();
    try { localStorage.removeItem("ascii-wallpaper"); } catch {}
    say("New tabs show the built-in wallpapers again (pick one from the Wallpapers button).");
  };
  $("btn-wall-open").onclick = () => chrome.tabs.create({});
}

// The desktop app (Electron) exposes window.asciiDesktop through its preload script.
const desk = window.asciiDesktop;
if (desk) {
  $("desktop-group").hidden = false;
  desk.capabilities().then((caps) => {
    if (!caps.liveWallpaper) {
      $("btn-desk-live").hidden = true;
      $("desk-note").textContent = "Live wallpapers aren't available on this system; the still image works everywhere.";
    }
  });
  // Still wallpaper: render once at the screen's full resolution, hand the PNG to the app.
  $("btn-desk-still").onclick = async () => {
    if (needSource()) return;
    const sel = $("size"), prev = sel.value;
    sel.value = "screen";
    const [w, h] = outputSize();
    renderer.resize(w, h);
    renderer.render(0);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    sel.value = prev;
    lastTick = -1;
    const res = await desk.setStillWallpaper(await blob.arrayBuffer());
    say(res.ok ? "Desktop wallpaper set." : `Couldn't set the wallpaper (${res.error}).`);
  };
  $("btn-desk-live").onclick = async () => {
    if (!(await storePicture())) return;
    const res = await desk.setLiveWallpaper("custom");
    say(res.ok ? "Live wallpaper on. Change or stop it from the menu-bar icon." : res.error);
  };
}
