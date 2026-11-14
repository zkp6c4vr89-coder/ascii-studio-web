import { AsciiRenderer } from "./renderer.js";
import { saveWallpaper, clearWallpaper } from "./wallpaper-store.js";

const $ = (id) => document.getElementById(id);
const stage = $("stage"), canvas = $("out"), status = $("status");
const inExtension = /-extension:$/.test(location.protocol);
let renderer;
try {
  renderer = new AsciiRenderer(canvas);
} catch (e) {
  $("drop").innerHTML = `<strong>Sorry, this browser can't run ASCII Studio</strong><span>${e.message}</span>`;
  throw e;
}
const S = renderer.settings;

let video = null, stream = null, kind = null, objectUrl = null, currentFile = null;
let recorder = null, recTimer = null;
const say = (msg) => { status.textContent = msg; };

// ---------- sources ----------
function stopCurrent() {
  if (recorder) recorder.stop();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  if (video) video.pause();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  stream = video = objectUrl = currentFile = null;
  $("btn-cam").classList.remove("active");
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
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) {
    say("Webcam blocked: allow camera access in the address bar, then try again.");
    return;
  }
  video = Object.assign(document.createElement("video"), { srcObject: stream, muted: true, playsInline: true });
  await video.play();
  kind = "webcam";
  S.mode = "source";
  if (!$("mirror").checked) { $("mirror").checked = true; S.mirror = true; }
  renderer.setSource(video);
  stage.classList.remove("empty");
  $("btn-cam").classList.add("active");
  say("Webcam on.");
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
      $("drop").innerHTML = `<strong>One click to load this ${isVideo ? "video" : "image"}</strong>
        <span>ASCII Studio needs permission to read files from ${origin}</span>
        <button id="btn-allow" class="primary">Allow ${new URL(src).host}</button>`;
      $("btn-allow").onclick = async (e) => {
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
$("btn-rain").onclick = startRain;
stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("dragging"); });
stage.addEventListener("dragleave", () => stage.classList.remove("dragging"));
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  stage.classList.remove("dragging");
  loadFile(e.dataTransfer.files[0]);
});

// ---------- controls ----------
function setSeg(id, v) {
  document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.v === v));
}
document.querySelectorAll("#style button").forEach((b) => (b.onclick = () => { S.style = b.dataset.v; setSeg("style", b.dataset.v); }));

const LABELS = { cell: (v) => `${v}px`, fps: (v) => `${v} / sec` };
for (const id of ["cell", "contrast", "edgeThreshold", "glow", "shimmer", "fps"]) {
  const input = $(id), out = document.querySelector(`output[data-for="${id}"]`);
  const sync = () => { S[id] = parseFloat(input.value); out.textContent = (LABELS[id] || String)(input.value); };
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
document.querySelectorAll("#dur button").forEach((b) => (b.onclick = () => { setSeg("dur", b.dataset.v); syncDuration(); }));
$("custom-dur").oninput = syncDuration;
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
  const h = choice === "source" ? Math.min(src[1], Math.round(1920 / aspect), 1920) : parseInt(choice, 10);
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
function download(blob, name) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const needSource = () => { if (!kind) { say("Open a photo, video or webcam first."); return true; } return false; };

$("btn-png").onclick = () => {
  if (needSource()) return;
  canvas.toBlob((b) => download(b, `ascii-${stamp()}.png`), "image/png");
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
  download(new Blob([renderer.toText()], { type: "text/plain" }), `ascii-${stamp()}.txt`);
};

// ---------- record a loop of a chosen length ----------
function pickMime() {
  const options = ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return options.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || "";
}

$("btn-video").onclick = () => {
  if (needSource()) return;
  if (recorder) { recorder.stop(); return; }          // stop early
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
    download(new Blob(chunks, { type: mime.split(";")[0] }), `ascii-loop-${secs}s-${stamp()}.${ext}`);
    recorder = null;
    if (video && kind === "video") video.muted = true;
    $("rec").hidden = true;
    $("btn-video").classList.remove("recording");
    syncDuration();
    say(`Saved a ${secs}s loop (.${ext}).`);
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

// ---------- browser wallpaper (extension only) ----------
if (inExtension) {
  $("wallpaper-group").hidden = false;
  const look = () => {
    const { style, cell, contrast, gamma, saturation, edges, edgeThreshold, glow, shimmer, fps, period, mirror } = S;
    return { style, cell, contrast, gamma, saturation, edges, edgeThreshold, glow, shimmer, fps, period, mirror };
  };
  $("btn-wall").onclick = async () => {
    if (needSource()) return;
    if (kind === "webcam") { say("The webcam can't be a wallpaper. Use a photo, video or Rain."); return; }
    const settings = look();
    if (kind === "image" && settings.shimmer === 0) settings.shimmer = 0.5;   // photos need a little life
    try {
      await saveWallpaper(kind === "rain"
        ? { mode: "rain", settings }
        : { mode: "source", blob: currentFile, isVideo: kind === "video", settings });
      say("Done! Open a new tab to see it.");
    } catch (e) {
      say(`Couldn't save the wallpaper (${e.message}).`);
    }
  };
  $("btn-wall-reset").onclick = async () => { await clearWallpaper(); say("New tabs show character rain again."); };
  $("btn-wall-open").onclick = () => chrome.tabs.create({});
}
