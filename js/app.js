import {
  HandLandmarker,
  FilesetResolver,
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
const statusText = document.getElementById("status-text");
const modeButtonsWrap = document.getElementById("mode-buttons");
const palette = document.getElementById("palette");
const customColor = document.getElementById("custom-color");
const brushSize = document.getElementById("brush-size");
const brushSizeLabel = document.getElementById("brush-size-label");
const glowTrailToggle = document.getElementById("glow-trail");
const mirrorToggle = document.getElementById("mirror-toggle");
const clearBtn = document.getElementById("clear-btn");
const saveBtn = document.getElementById("save-btn");

// ---------- State ----------
const PRESET_COLORS = [
  "#ff2d75", "#00e5ff", "#7cff00", "#ffea00",
  "#b967ff", "#ff7a00", "#ffffff", "#00ffa3",
];

const FINGERTIPS = [4, 8, 12, 16, 20];
const FINGER_PIPS = [3, 6, 10, 14, 18];

let currentColor = "#00e5ff";
let currentBrushSize = 8;
let currentMode = "draw";
let glowTrail = false;

let handLandmarker = null;
let running = false;
let lastPoints = {}; // handIndex -> {x,y} for draw mode
let particles = []; // sparks
let animHandle = null;

// ---------- Palette setup ----------
function buildPalette() {
  PRESET_COLORS.forEach((color, i) => {
    const btn = document.createElement("button");
    btn.className = "swatch";
    btn.style.background = color;
    btn.dataset.color = color;
    if (i === 1) btn.classList.add("selected");
    btn.addEventListener("click", () => selectColor(color, btn));
    palette.appendChild(btn);
  });
}

function selectColor(color, btnEl) {
  currentColor = color;
  document
    .querySelectorAll(".swatch")
    .forEach((el) => el.classList.remove("selected"));
  if (btnEl) btnEl.classList.add("selected");
  customColor.value = color;
}

customColor.addEventListener("input", (e) => {
  currentColor = e.target.value;
  document
    .querySelectorAll(".swatch")
    .forEach((el) => el.classList.remove("selected"));
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
  lastPoints = {};
});

brushSize.addEventListener("input", (e) => {
  currentBrushSize = Number(e.target.value);
  brushSizeLabel.textContent = `${currentBrushSize} px`;
});

glowTrailToggle.addEventListener("change", (e) => {
  glowTrail = e.target.checked;
});

mirrorToggle.addEventListener("change", (e) => {
  stage.classList.toggle("no-mirror", !e.target.checked);
});

clearBtn.addEventListener("click", () => {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
});

saveBtn.addEventListener("click", () => {
  const out = document.createElement("canvas");
  out.width = drawCanvas.width;
  out.height = drawCanvas.height;
  const outCtx = out.getContext("2d");
  outCtx.fillStyle = "#0b0d14";
  outCtx.fillRect(0, 0, out.width, out.height);
  outCtx.drawImage(drawCanvas, 0, 0);
  const link = document.createElement("a");
  link.download = `handtrackdraw-${Date.now()}.png`;
  link.href = out.toDataURL("image/png");
  link.click();
});

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

function handScale(landmarks) {
  return dist(landmarks[0], landmarks[9]) || 0.001;
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

function drawStrings(handsData, time) {
  handsData.forEach(({ landmarks }, handIdx) => {
    const wrist = landmarks[0];
    const palmCenter = toPixel(landmarks[9]);
    const scale = handScale(landmarks);

    FINGERTIPS.forEach((tipIdx, i) => {
      const pipIdx = FINGER_PIPS[i];
      if (!isFingerExtended(landmarks, wrist, tipIdx, pipIdx)) return;
      const tipPx = toPixel(landmarks[tipIdx]);
      const pulse = 3 + Math.sin(time / 150 + i + handIdx * 2) * 2;
      const hue = (time / 20 + i * 40 + handIdx * 180) % 360;
      const color = `hsl(${hue}, 100%, 65%)`;
      strokeGlowLine(fxCtx, palmCenter, tipPx, color, Math.max(pulse, 1.5));
      drawCursor(fxCtx, tipPx, color, true);
    });

    void scale;
  });

  // Connect hands together for a two-hand "string" effect
  if (handsData.length === 2) {
    const p0 = toPixel(handsData[0].landmarks[8]);
    const p1 = toPixel(handsData[1].landmarks[8]);
    const hue = (time / 10) % 360;
    strokeGlowLine(fxCtx, p0, p1, `hsl(${hue}, 100%, 70%)`, 3);
  }
}

// ---------- Main per-frame processing ----------
function processHands(handsData) {
  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);

  const time = performance.now();
  const seenHands = new Set();

  handsData.forEach(({ landmarks }, handIdx) => {
    seenHands.add(handIdx);
    const wrist = landmarks[0];
    const scale = handScale(landmarks);
    const pinchDist = dist(landmarks[4], landmarks[8]);
    const pinching = pinchDist < scale * 0.55;
    const indexTip = toPixel(landmarks[8]);

    drawCursor(fxCtx, indexTip, currentColor, pinching);

    if (currentMode === "draw") {
      if (pinching) {
        if (glowTrail) {
          drawCtx.save();
          drawCtx.globalCompositeOperation = "destination-out";
          drawCtx.fillStyle = "rgba(0,0,0,0.06)";
          drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
          drawCtx.restore();
        }
        const prev = lastPoints[handIdx];
        if (prev) {
          strokeGlowLine(drawCtx, prev, indexTip, currentColor, currentBrushSize);
        }
        lastPoints[handIdx] = indexTip;
      } else {
        lastPoints[handIdx] = null;
      }
    } else if (currentMode === "sparks") {
      if (pinching) spawnParticles(indexTip, currentColor);
    }

    void wrist;
  });

  // clear stale lastPoints for hands no longer visible
  Object.keys(lastPoints).forEach((k) => {
    if (!seenHands.has(Number(k))) delete lastPoints[k];
  });

  if (currentMode === "strings") {
    drawStrings(handsData, time);
  }

  if (currentMode === "sparks" || particles.length) {
    updateAndDrawParticles(fxCtx);
  }

  statusText.textContent = handsData.length
    ? `Hand detected (${handsData.length})`
    : "No hand detected";
  statusText.classList.toggle("active", handsData.length > 0);
}

// ---------- Camera + detection loop ----------
async function setupHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numHands: 2,
  });
}

function resizeCanvases() {
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  [drawCanvas, fxCanvas].forEach((c) => {
    c.width = w;
    c.height = h;
  });
}

function loop() {
  if (!running) return;
  if (handLandmarker && video.readyState >= 2) {
    const results = handLandmarker.detectForVideo(video, performance.now());
    const handsData = (results.landmarks || []).map((landmarks) => ({
      landmarks,
    }));
    processHands(handsData);
  }
  animHandle = requestAnimationFrame(loop);
}

async function startCamera() {
  try {
    startBtn.disabled = true;
    overlayMsg.textContent = "";
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    resizeCanvases();

    if (!handLandmarker) {
      overlayMsg.textContent = "Loading hand-tracking model...";
      await setupHandLandmarker();
    }

    startOverlay.classList.add("hidden");
    running = true;
    loop();
  } catch (err) {
    console.error(err);
    overlayMsg.textContent =
      "Could not access camera / load model: " + (err.message || err);
    startBtn.disabled = false;
  }
}

startBtn.addEventListener("click", startCamera);

window.addEventListener("resize", () => {
  if (video.videoWidth) resizeCanvases();
});

buildPalette();
selectColor(currentColor, palette.children[1]);
