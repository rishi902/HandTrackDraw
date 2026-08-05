// This is deliberately a CLASSIC (non-module) worker, not { type: "module" }.
// MediaPipe's tasks-vision WASM bootstrap calls importScripts() internally
// when it detects a Worker context, and per spec that throws
// ("Module scripts don't support importScripts()") inside a module worker —
// Chromium keeps the function reference around so feature-detection sees it
// as available, but calling it fails. Classic workers support importScripts
// natively, so we load the (ES module) vision bundle here via a dynamic
// import() instead of a static import — dynamic import works in classic
// worker scripts too, and the module it loads still runs in this same
// global scope, where importScripts works normally.

// Self-hosted, not loaded from a third-party CDN: home/school/work networks,
// ad blockers, and privacy extensions have repeatedly blocked
// cdn.jsdelivr.net and storage.googleapis.com for users of this app, which
// made hand tracking silently fail to load. Serving these same-origin from
// GitHub Pages removes that entire class of failure.
const WASM_URL = new URL("../vendor/mediapipe/wasm", self.location.href).href;
const MODEL_URL = new URL("../models/hand_landmarker.task", self.location.href).href;
const VISION_BUNDLE_URL = new URL("../vendor/mediapipe/vision_bundle.mjs", self.location.href).href;

let handLandmarker = null;
const options = {
  numHands: 2,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
};

function landmarkerConfig() {
  return {
    runningMode: "VIDEO",
    numHands: options.numHands,
    minHandDetectionConfidence: options.minHandDetectionConfidence,
    minHandPresenceConfidence: options.minHandPresenceConfidence,
    minTrackingConfidence: options.minTrackingConfidence,
  };
}

async function createLandmarker() {
  const { HandLandmarker, FilesetResolver } = await import(VISION_BUNDLE_URL);
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      ...landmarkerConfig(),
    });
  } catch (gpuErr) {
    // Some browsers/drivers don't support the GPU delegate reliably — fall
    // back to CPU rather than leaving hand tracking completely broken.
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
      ...landmarkerConfig(),
    });
  }
}

self.onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === "INIT") {
    Object.assign(options, msg.options);
    try {
      await createLandmarker();
      self.postMessage({ type: "READY" });
    } catch (err) {
      self.postMessage({ type: "ERROR", message: String(err?.message || err) });
    }
    return;
  }

  if (msg.type === "SET_OPTIONS") {
    Object.assign(options, msg.options);
    if (handLandmarker) {
      try {
        await handLandmarker.setOptions(landmarkerConfig());
      } catch (err) {
        self.postMessage({ type: "ERROR", message: String(err?.message || err) });
      }
    }
    return;
  }

  if (msg.type === "DETECT") {
    const { bitmap, timestamp } = msg;
    if (!handLandmarker) {
      bitmap.close();
      return;
    }
    try {
      const result = handLandmarker.detectForVideo(bitmap, timestamp);
      self.postMessage({
        type: "RESULT",
        landmarks: result.landmarks,
        handedness: result.handedness,
        timestamp,
      });
    } catch (err) {
      self.postMessage({ type: "ERROR", message: String(err?.message || err) });
    } finally {
      bitmap.close();
    }
  }
};
