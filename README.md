# HandTrackDraw

Draw on the screen by hand/finger tracking! Point your webcam at yourself,
pick a color, and pinch your thumb and index finger together to paint neon
strokes, glowing "strings", or particle sparks in the air.

## Features

- **Real-time hand tracking** in the browser using Google's [MediaPipe
  HandLandmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) —
  no install, no server-side ML, everything runs on-device via WebAssembly,
  in a **Web Worker** so inference never blocks drawing/rendering.
- **Smoothed, jitter-free tracking** — fingertip positions are eased every
  render frame and hands are identified by handedness (Left/Right) rather
  than array order, so strokes don't jump or flicker.
- Optional **hand skeleton overlay** and **detection-confidence sliders**
  (max hands, detection/presence/tracking confidence) for tuning tracking
  to your lighting/camera.
- **Three visual modes**
  - ✏️ **Draw** — pinch to paint a persistent freehand stroke. Toggle "Glow
    trail" for a fading light-painting effect instead of a permanent line.
  - 🎇 **Strings** — glowing lines radiate from your palm to each extended
    fingertip, pulsing and color-cycling. Hold up both hands and a string
    connects your two index fingers too.
  - ✨ **Sparks** — pinch to shoot a colored particle trail from your
    fingertip, complete with gravity and fade-out.
- **Full color control** — 8 neon presets plus a custom color picker.
- **Adjustable brush size**, mirror toggle, clear canvas, and save-as-PNG.

## Running it

No build step required — it's plain HTML/CSS/JS loaded via ES modules and a
CDN-hosted MediaPipe bundle. You just need to serve the folder over HTTP
(camera access requires `http://localhost` or `https://`, plain `file://`
won't work in most browsers):

```bash
# from the repo root
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000` in a recent Chrome or Edge, click **Start
Camera**, allow camera access, and give it a few seconds to download the
hand-tracking model on first load.

## How to use

1. Pick a **mode** (Draw / Strings / Sparks) from the right-hand panel.
2. Pick a **color** from the palette or the custom color swatch.
3. Hold your hand up in front of the camera.
4. **Pinch** your thumb and index fingertip together — that's your "pen
   down" gesture for Draw and Sparks mode. Strings mode is always active
   while your hand is visible; extend fingers to control how many strings
   radiate from your palm.
5. Use **Clear** to wipe the canvas, or **Save PNG** to download your
   drawing.
6. If tracking feels jittery or misses your hand, open **Detection
   tuning** and adjust the confidence sliders, or enable **Show hand
   skeleton** to see exactly what the model is tracking.

## Notes

- Works best in good, even lighting with your hand clearly visible.
- Everything (video processing, hand detection, drawing) happens locally in
  your browser — no frames are uploaded anywhere.
- Tested in Chrome/Edge. Camera + WebGPU/WebGL support varies across
  browsers, so if tracking doesn't start, try the latest Chrome.
