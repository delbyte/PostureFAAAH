# PostureFAAAH

PostureFAAAH is a minimal client-side posture detector: it uses a browser-based face-landmarks model
to detect when a laptop user slouches and plays an alert sound on the user's machine. All ML and
video processing happen locally in the browser — no video or landmarks are uploaded to any server.

Files added:
- `index.html` — main UI and camera
- `script.js` — loads the model and performs slouch detection
- `style.css` — simple styles
- `sound/alert.mp3` — (you can add your own) sound file to play when slouch detected

Usage:
1. Place your alert sound at `sound/alert.mp3`.
2. Open `index.html` in a modern browser (or deploy to Vercel and visit the site).
3. Click "Start" and grant camera access. Allow audio playback on first gesture.

Notes:
- Detection uses `@tensorflow-models/face-landmarks-detection` and runs in the browser.
- Tweak the sensitivity slider to adjust how easily slouching triggers the alert.
