import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

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
