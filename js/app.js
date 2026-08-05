import {
  HandLandmarker,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// ---------- DOM ----------
const video = document.getElementById("video");
const drawCanvas = document.getElementById("draw-canvas");
const fxCanvas = document.getElementById("fx-canvas");
const drawCtx = drawCanvas.getContext("2d");
const fxCtx = fxCanvas.getContext("2d");
const stage = document.getElementById("stage");
const startOverlay = document.getElementById("start-overlay");
const startBtn = document.getElementById("start-btn");
const overlayMsg = document.getElementById("overlay-msg");
const statusCamera = document.getElementById("status-camera");
const statusModel = document.getElementById("status-model");
const statusText = document.getElementById("status-text");
const statusHint = document.getElementById("status-hint");
const modeButtonsWrap = document.getElementById("mode-buttons");
const wheelCanvas = document.getElementById("color-wheel");
const wheelCtx = wheelCanvas.getContext("2d");
const wheelCursor = document.getElementById("wheel-cursor");
const colorPreview = document.getElementById("color-preview");
const colorHex = document.getElementById("color-hex");
const brightnessSlider = document.getElementById("color-brightness");
const brushSize = document.getElementById("brush-size");
const brushSizeLabel = document.getElementById("brush-size-label");
const glowTrailToggle = document.getElementById("glow-trail");
const mirrorToggle = document.getElementById("mirror-toggle");
const skeletonToggle = document.getElementById("show-skeleton");
const clearBtn = document.getElementById("clear-btn");
const saveBtn = document.getElementById("save-btn");

// ---------- Tunables ----------
const FINGERTIPS = [4, 8, 12, 16, 20];
const FINGER_PIPS = [3, 6, 10, 14, 18];

const POSITION_SMOOTHING = 0.35; // lower = smoother/laggier, higher = snappier
const PINCH_ON_RATIO = 0.45; // start pinch when dist < scale * this
const PINCH_OFF_RATIO = 0.62; // release pinch when dist > scale * this (hysteresis avoids flicker)
const MIN_DRAW_DELTA = 0.4; // px, skip near-zero-length segments while still

const MODEL_LOAD_TIMEOUT_MS = 20000;
const NO_HAND_HINT_DELAY_MS = 6000;

// ---------- State ----------
let currentColor = "#00e5ff";
let currentHue = 190;
let currentSat = 1;
let currentVal = 1;
let currentBrushSize = 8;
let currentMode = "draw";
let glowTrail = false;
let showSkeleton = false;

let running = false;
let workerReady = false;
let awaitingDetection = false;
let worker = null;
let drawingUtils = null;
let modelLoadTimer = null;
let noHandHintTimer = null;
let everSawHand = false;

let particles = [];
/** @type {Map<string, HandState>} keyed by handedness label ("Left"/"Right") for stable identity across frames */
const trackedHands = new Map();

const workerOptions = {
  numHands: 1,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

// ---------- Color wheel ----------
function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function rgbToHex(r, g, b) {
  return (
    "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")
  );
}

function drawColorWheel() {
  const w = wheelCanvas.width;
  const h = wheelCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = w / 2;

  wheelCtx.clearRect(0, 0, w, h);
  wheelCtx.save();
  wheelCtx.beginPath();
  wheelCtx.arc(cx, cy, r, 0, Math.PI * 2);
  wheelCtx.clip();

  const conic = wheelCtx.createConicGradient(-Math.PI / 2, cx, cy);
  for (let i = 0; i <= 360; i += 15) {
    conic.addColorStop(i / 360, `hsl(${i},100%,50%)`);
  }
  wheelCtx.fillStyle = conic;
  wheelCtx.fillRect(0, 0, w, h);

  const radial = wheelCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
  radial.addColorStop(0, "rgba(255,255,255,1)");
  radial.addColorStop(1, "rgba(255,255,255,0)");
  wheelCtx.fillStyle = radial;
  wheelCtx.fillRect(0, 0, w, h);

  wheelCtx.restore();
  wheelCtx.strokeStyle = "#333";
  wheelCtx.lineWidth = 1;
  wheelCtx.beginPath();
  wheelCtx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
  wheelCtx.stroke();
}

function applyColorFromHsv() {
  const [r, g, b] = hsvToRgb(currentHue, currentSat, currentVal);
  currentColor = rgbToHex(r, g, b);
  colorPreview.style.background = currentColor;
  colorHex.textContent = currentColor.toUpperCase();
}

function setWheelCursorFromHsv() {
  const w = wheelCanvas.width;
  const cx = w / 2;
  const r = w / 2;
  const angle = (currentHue / 360) * Math.PI * 2 - Math.PI / 2;
  const dist = currentSat * r;
  const x = cx + Math.cos(angle) * dist;
  const y = cx + Math.sin(angle) * dist;
  wheelCursor.style.left = `${x}px`;
  wheelCursor.style.top = `${y}px`;
}

function pickColorFromWheelEvent(clientX, clientY) {
  const rect = wheelCanvas.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const r = rect.width / 2;
  const dx = clientX - rect.left - cx;
  const dy = clientY - rect.top - cy;
  const dist = Math.min(Math.hypot(dx, dy), r);
  let angle = Math.atan2(dy, dx) + Math.PI / 2;
  if (angle < 0) angle += Math.PI * 2;

  currentHue = (angle / (Math.PI * 2)) * 360;
  currentSat = dist / r;
  applyColorFromHsv();
  setWheelCursorFromHsv();
}

let wheelDragging = false;
wheelCanvas.addEventListener("pointerdown", (e) => {
  wheelDragging = true;
  wheelCanvas.setPointerCapture(e.pointerId);
  pickColorFromWheelEvent(e.clientX, e.clientY);
});
wheelCanvas.addEventListener("pointermove", (e) => {
  if (wheelDragging) pickColorFromWheelEvent(e.clientX, e.clientY);
});
wheelCanvas.addEventListener("pointerup", () => {
  wheelDragging = false;
});

brightnessSlider.addEventListener("input", (e) => {
  currentVal = Number(e.target.value);
  applyColorFromHsv();
});

// ---------- Mode setup ----------
modeButtonsWrap.addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-btn");
  if (!btn) return;
  currentMode = btn.dataset.mode;
  document
    .querySelectorAll(".mode-btn")
    .forEach((el) => el.classList.remove("active"));
  btn.classList.add("active");
  trackedHands.forEach((state) => (state.lastDrawPoint = null));
});

brushSize.addEventListener("input", (e) => {
  currentBrushSize = Number(e.target.value);
  brushSizeLabel.textContent = `${currentBrushSize} PX`;
});

glowTrailToggle.addEventListener("change", (e) => {
  glowTrail = e.target.checked;
});

mirrorToggle.addEventListener("change", (e) => {
  stage.classList.toggle("no-mirror", !e.target.checked);
});

skeletonToggle.addEventListener("change", (e) => {
  showSkeleton = e.target.checked;
});

clearBtn.addEventListener("click", () => {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
});

saveBtn.addEventListener("click", () => {
  const out = document.createElement("canvas");
  out.width = drawCanvas.width;
  out.height = drawCanvas.height;
  const outCtx = out.getContext("2d");
  outCtx.fillStyle = "#000000";
  outCtx.fillRect(0, 0, out.width, out.height);
  outCtx.drawImage(drawCanvas, 0, 0);
  const link = document.createElement("a");
  link.download = `handtrackdraw-${Date.now()}.png`;
  link.href = out.toDataURL("image/png");
  link.click();
});

// ---------- Advanced detection settings ----------
function setupAdvancedSlider(id, key, isInt) {
  const input = document.getElementById(id);
  const label = document.getElementById(`${id}-value`);
  if (!input) return;
  input.addEventListener("input", () => {
    const val = isInt ? parseInt(input.value, 10) : parseFloat(input.value);
    if (label) label.textContent = String(val);
    workerOptions[key] = val;
    worker?.postMessage({ type: "SET_OPTIONS", options: { [key]: val } });
  });
}

setupAdvancedSlider("num-hands", "numHands", true);
setupAdvancedSlider("min-hand-detection-confidence", "minHandDetectionConfidence", false);
setupAdvancedSlider("min-hand-presence-confidence", "minHandPresenceConfidence", false);
setupAdvancedSlider("min-tracking-confidence", "minTrackingConfidence", false);

// ---------- Geometry helpers ----------
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toPixel(landmark) {
  return {
    x: landmark.x * drawCanvas.width,
    y: landmark.y * drawCanvas.height,
  };
}

function isFingerExtended(landmarks, wrist, tipIdx, pipIdx) {
  return dist(wrist, landmarks[tipIdx]) > dist(wrist, landmarks[pipIdx]) * 1.15;
}

// ---------- Drawing primitives ----------
function strokeGlowLine(ctx, from, to, color, size) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 1.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

function drawCursor(ctx, point, color, filled) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, filled ? 10 : 14, 0, Math.PI * 2);
  if (filled) ctx.fill();
  else ctx.stroke();
  ctx.restore();
}

function spawnParticles(point, color) {
  for (let i = 0; i < 3; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 3;
    particles.push({
      x: point.x,
      y: point.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1,
      life: 1,
      decay: 0.02 + Math.random() * 0.02,
      size: 2 + Math.random() * 3,
      color,
    });
  }
}

function updateAndDrawParticles(ctx) {
  particles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.05; // gravity
    p.life -= p.decay;
  });
  particles = particles.filter((p) => p.life > 0);

  particles.forEach((p) => {
    ctx.save();
    ctx.globalAlpha = Math.max(p.life, 0);
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawStrings(handStates, time) {
  handStates.forEach((state, handIdx) => {
    const wristNorm = state.landmarksNorm[0];
    const palmPx = state.smoothPx[9];

    FINGERTIPS.forEach((tipIdx, i) => {
      const pipIdx = FINGER_PIPS[i];
      if (!isFingerExtended(state.landmarksNorm, wristNorm, tipIdx, pipIdx)) return;
      const tipPx = state.smoothPx[tipIdx];
      const pulse = 3 + Math.sin(time / 150 + i + handIdx * 2) * 2;
      const hue = (time / 20 + i * 40 + handIdx * 180) % 360;
      const color = `hsl(${hue}, 100%, 65%)`;
      strokeGlowLine(fxCtx, palmPx, tipPx, color, Math.max(pulse, 1.5));
      drawCursor(fxCtx, tipPx, color, true);
    });
  });

  if (handStates.length === 2) {
    const p0 = handStates[0].smoothPx[8];
    const p1 = handStates[1].smoothPx[8];
    const hue = (time / 10) % 360;
    strokeGlowLine(fxCtx, p0, p1, `hsl(${hue}, 100%, 70%)`, 3);
  }
}

function drawSkeleton(state) {
  if (!drawingUtils) drawingUtils = new DrawingUtils(fxCtx);
  drawingUtils.drawConnectors(state.landmarksNorm, HandLandmarker.HAND_CONNECTIONS, {
    color: "rgba(255,255,255,0.5)",
    lineWidth: 2,
  });
  drawingUtils.drawLandmarks(state.landmarksNorm, {
    color: "rgba(255,255,255,0.8)",
    lineWidth: 1,
    radius: 2,
  });
}

// ---------- Hand tracking state ----------
function updateTrackedHands(landmarksList, handednessList) {
  const seenKeys = new Set();

  (landmarksList || []).forEach((landmarks, i) => {
    const label = handednessList?.[i]?.[0]?.categoryName || `hand${i}`;
    seenKeys.add(label);

    const targetPx = landmarks.map(toPixel);
    const scale = dist(landmarks[0], landmarks[9]) || 0.001;
    const pinchDist = dist(landmarks[4], landmarks[8]);

    let state = trackedHands.get(label);
    if (!state) {
      state = {
        smoothPx: targetPx.map((p) => ({ ...p })),
        pinching: false,
        lastDrawPoint: null,
      };
      trackedHands.set(label, state);
    }

    state.landmarksNorm = landmarks;
    state.targetPx = targetPx;
    state.scale = scale;
    state.pinchDist = pinchDist;

    if (!state.pinching && pinchDist < scale * PINCH_ON_RATIO) {
      state.pinching = true;
    } else if (state.pinching && pinchDist > scale * PINCH_OFF_RATIO) {
      state.pinching = false;
    }
  });

  Array.from(trackedHands.keys()).forEach((key) => {
    if (!seenKeys.has(key)) trackedHands.delete(key);
  });

  if (landmarksList && landmarksList.length && !everSawHand) {
    everSawHand = true;
    clearNoHandHintTimer();
    statusHint.textContent = "";
  }
}

// ---------- Render loop (always runs at display refresh, independent of detection rate) ----------
function renderFrame() {
  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

  if (glowTrail) {
    drawCtx.save();
    drawCtx.globalCompositeOperation = "destination-out";
    drawCtx.fillStyle = "rgba(0,0,0,0.05)";
    drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
    drawCtx.restore();
  }

  const time = performance.now();
  const handStates = Array.from(trackedHands.values());

  handStates.forEach((state) => {
    // Ease the rendered position toward the latest detection every frame,
    // regardless of how often new detections actually arrive. This is what
    // keeps strokes/cursor smooth even though inference runs in a worker at
    // a lower, less regular cadence than the display refresh rate.
    state.smoothPx = state.smoothPx.map((p, i) => ({
      x: p.x + (state.targetPx[i].x - p.x) * POSITION_SMOOTHING,
      y: p.y + (state.targetPx[i].y - p.y) * POSITION_SMOOTHING,
    }));

    const tip = state.smoothPx[8];
    drawCursor(fxCtx, tip, currentColor, state.pinching);
    if (showSkeleton) drawSkeleton(state);

    if (currentMode === "draw") {
      if (state.pinching) {
        if (!state.lastDrawPoint) {
          // Starting a new stroke: draw a dot immediately so a stationary
          // pinch still marks the canvas, not just ones that move first.
          strokeGlowLine(drawCtx, tip, tip, currentColor, currentBrushSize);
          state.lastDrawPoint = { ...tip };
        } else if (dist(state.lastDrawPoint, tip) > MIN_DRAW_DELTA) {
          strokeGlowLine(drawCtx, state.lastDrawPoint, tip, currentColor, currentBrushSize);
          state.lastDrawPoint = { ...tip };
        }
      } else {
        state.lastDrawPoint = null;
      }
    } else if (currentMode === "sparks") {
      if (state.pinching) spawnParticles(tip, currentColor);
    }
  });

  if (currentMode === "strings" && handStates.length) {
    drawStrings(handStates, time);
  }

  if (currentMode === "sparks" || particles.length) {
    updateAndDrawParticles(fxCtx);
  }

  statusText.textContent = handStates.length
    ? `HAND: ${handStates.length}`
    : "HAND: NONE";
  statusText.classList.toggle("ok", handStates.length > 0);
  statusText.classList.toggle("warn", handStates.length === 0 && workerReady);

  if (running) requestAnimationFrame(renderFrame);
}

// ---------- Diagnostics / watchdogs ----------
function clearModelLoadTimer() {
  if (modelLoadTimer) {
    clearTimeout(modelLoadTimer);
    modelLoadTimer = null;
  }
}

function clearNoHandHintTimer() {
  if (noHandHintTimer) {
    clearTimeout(noHandHintTimer);
    noHandHintTimer = null;
  }
}

function armModelLoadTimer() {
  clearModelLoadTimer();
  modelLoadTimer = setTimeout(() => {
    if (!workerReady) {
      statusModel.textContent = "MODEL: FAILED";
      statusModel.classList.add("warn");
      overlayMsg.textContent =
        "Hand-tracking model is taking too long to load. This is usually a " +
        "network/firewall issue — school, work, or public Wi-Fi networks " +
        "often block cdn.jsdelivr.net or storage.googleapis.com, and ad " +
        "blockers/privacy extensions can too. Try a different network " +
        "(e.g. mobile data), disable extensions for this site, or check " +
        "the browser console (F12) for the exact blocked request.";
      startBtn.disabled = false;
      startOverlay.classList.remove("hidden");
    }
  }, MODEL_LOAD_TIMEOUT_MS);
}

function armNoHandHintTimer() {
  clearNoHandHintTimer();
  noHandHintTimer = setTimeout(() => {
    if (!everSawHand) {
      statusHint.textContent =
        "No hand seen yet — make sure your hand is fully in frame with " +
        "good lighting, or lower the confidence sliders in Detection Tuning.";
    }
  }, NO_HAND_HINT_DELAY_MS);
}

// ---------- Worker + detection pump ----------
function setupWorker() {
  worker = new Worker(new URL("./hand-worker.js", import.meta.url), {
    type: "module",
  });

  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "READY") {
      workerReady = true;
      clearModelLoadTimer();
      statusModel.textContent = "MODEL: READY";
      statusModel.classList.add("ok");
      armNoHandHintTimer();
    } else if (msg.type === "RESULT") {
      awaitingDetection = false;
      updateTrackedHands(msg.landmarks, msg.handedness);
    } else if (msg.type === "ERROR") {
      awaitingDetection = false;
      console.error("hand-worker error:", msg.message);
      statusModel.textContent = "MODEL: ERROR";
      statusModel.classList.add("warn");
      overlayMsg.textContent = "Hand-tracking error: " + msg.message;
    }
  };

  worker.postMessage({ type: "INIT", options: workerOptions });
  armModelLoadTimer();
}

function pumpFrame() {
  if (!running) return;

  if (workerReady && !awaitingDetection && video.readyState >= 2) {
    awaitingDetection = true;
    createImageBitmap(video)
      .then((bitmap) => {
        worker.postMessage({ type: "DETECT", bitmap, timestamp: performance.now() }, [
          bitmap,
        ]);
      })
      .catch(() => {
        awaitingDetection = false;
      });
  }

  if (video.requestVideoFrameCallback) {
    video.requestVideoFrameCallback(pumpFrame);
  } else {
    requestAnimationFrame(pumpFrame);
  }
}

function resizeCanvases() {
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  [drawCanvas, fxCanvas].forEach((c) => {
    c.width = w;
    c.height = h;
  });
}

async function startCamera() {
  try {
    startBtn.disabled = true;
    overlayMsg.textContent = "";
    statusCamera.textContent = "CAMERA: STARTING...";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    resizeCanvases();
    statusCamera.textContent = "CAMERA: ON";
    statusCamera.classList.add("ok");

    if (!worker) {
      overlayMsg.textContent = "Loading hand-tracking model...";
      statusModel.textContent = "MODEL: LOADING...";
      setupWorker();
    }

    startOverlay.classList.add("hidden");
    running = true;
    pumpFrame();
    requestAnimationFrame(renderFrame);
  } catch (err) {
    console.error(err);
    statusCamera.textContent = "CAMERA: ERROR";
    statusCamera.classList.add("warn");
    overlayMsg.textContent =
      "Could not access camera: " + (err.message || err);
    startBtn.disabled = false;
  }
}

startBtn.addEventListener("click", startCamera);

window.addEventListener("resize", () => {
  if (video.videoWidth) resizeCanvases();
});

drawColorWheel();
applyColorFromHsv();
setWheelCursorFromHsv();
