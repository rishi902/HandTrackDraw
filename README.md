# HandTrackDraw

Draw on the screen by hand/finger tracking! Point your webcam at yourself,
pick a color, and pinch your thumb and index finger together to paint neon
strokes, glowing "strings", or particle sparks in the air.

## Features

- **Real-time hand tracking** in the browser using Google's [MediaPipe
  HandLandmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) —
  no install, no server-side ML, everything runs on-device via WebAssembly,
  in a **Web Worker** so inference never blocks drawing/rendering. The
  WASM runtime and model are **vendored into this repo** (see
  `vendor/mediapipe/` and `models/`) and served same-origin, not from a
  third-party CDN — see [`vendor/mediapipe/README.md`](vendor/mediapipe/README.md).
- **Smoothed, jitter-free tracking** — fingertip positions are eased every
  render frame and hands are identified by handedness (Left/Right) rather
  than array order, so strokes don't jump or flicker.
- Optional **hand skeleton overlay** and **detection-confidence sliders**
  (max hands, detection/presence/tracking confidence) for tuning tracking
  to your lighting/camera.
- **Five visual modes**
  - ✏️ **Draw** — pinch to paint a persistent freehand stroke. Toggle "Glow
    trail" for a fading light-painting effect instead of a permanent line.
  - 🎇 **Strings** — glowing lines radiate from your palm to each extended
    fingertip, pulsing and color-cycling. Hold up both hands and a string
    connects your two index fingers too.
  - ✨ **Sparks** — pinch to shoot a colored particle trail from your
    fingertip, complete with gravity and fade-out.
  - 🌸 **Flower** — pinch to hold it as a closed bud; spread your fingers
    open and it blooms into a spidery, curved-petal flower. Move your hand
    side to side to spin it.
  - 🔮 **Jelly** — glassy, coiled "slinky" strings connect your palm to
    every fingertip, compressing into tight coils when your hand is closed
    and stretching out as you spread your fingers.
- **HSV color wheel** — click/drag anywhere on the wheel to pick a color,
  plus a brightness slider.
- **Adjustable brush size**, mirror toggle, clear canvas, and save-as-PNG.
- A live status bar (camera / model / hand state) so tracking problems are
  visible instead of silent, plus a built-in timeout that tells you if the
  model failed to load (see Troubleshooting below).

## Running it

No build step required — it's plain HTML/CSS/JS loaded via ES modules, with
the MediaPipe runtime and model vendored directly in this repo (nothing
fetched from a third-party CDN at runtime). You just need to serve the
folder over HTTP (camera access requires `http://localhost` or `https://`,
plain `file://` won't work in most browsers):

```bash
# from the repo root
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000` in a recent Chrome or Edge, click **Start
Camera**, allow camera access, and give it a few seconds to download the
hand-tracking model on first load.

## How to use

1. Pick a **mode** (Draw / Strings / Sparks / Flower / Jelly) from the
   right-hand panel.
2. Pick a **color** from the color wheel, and adjust brightness below it.
3. Hold your hand up in front of the camera.
4. **Pinch** your thumb and index fingertip together — that's your "pen
   down" gesture for Draw and Sparks mode, and holds Flower mode as a
   closed bud. Strings, Flower, and Jelly modes are otherwise always
   active while your hand is visible — extend/spread your fingers to
   control them.
5. Use **Clear** to wipe the canvas, or **Save PNG** to download your
   drawing.
6. If tracking feels jittery or misses your hand, open **Detection
   tuning** and adjust the confidence sliders, or enable **Show hand
   skeleton** to see exactly what the model is tracking.

## Troubleshooting: "it's not detecting my hand"

The status bar under the video (CAMERA / MODEL / HAND) tells you exactly
where things are stuck:

- **`MODEL: LOADING...` forever, then `MODEL: FAILED`** — the browser
  couldn't load the tracking model or WASM runtime. These now ship from
  this same site (see Features above), not a third-party CDN, so this
  usually means a slow connection, a browser/extension actively blocking
  scripts on the page, or a browser too old to support WebAssembly/Workers.
  Open DevTools (F12) → Network tab, reload, and look for a failed/blocked
  request under `vendor/` or `models/` to confirm.
- **`MODEL: READY` but `HAND: NONE` and a hint appears below the status
  bar** — the pipeline is working, it just isn't seeing a hand. Make sure
  your whole hand is in frame with decent lighting, or lower the sliders
  under **Detection Tuning**.
- Everything (video processing, hand detection, drawing) happens locally in
  your browser — no frames are uploaded anywhere, so none of this depends
  on any server we run.
- Tested in Chrome/Edge. Camera + WebGL support varies across browsers, so
  if tracking doesn't start, try the latest Chrome.
