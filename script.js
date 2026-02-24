import * as tf from 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.21.0/dist/tf.min.js';
import * as faceLandmarksDetection from 'https://cdn.jsdelivr.net/npm/@tensorflow-models/face-landmarks-detection@0.0.7/dist/face-landmarks-detection.min.js';

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const sensitivityEl = document.getElementById('sensitivity');
const debugEl = document.getElementById('debug');
const alertSound = document.getElementById('alertSound');

let model = null;
let run = false;
let stream = null;
let slouchCounter = 0;
let cooldown = false;

async function setupCamera() {
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
  video.srcObject = stream;
  await new Promise((r) => (video.onloadedmetadata = r));
  video.play();
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
}

function drawDebug(landmarks) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!landmarks) return;
  ctx.strokeStyle = 'lime';
  ctx.lineWidth = 2;
  for (const p of landmarks) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,255,0,0.8)';
    ctx.fill();
  }
}

function getPointMean(points) {
  const m = points.reduce((acc, p) => { acc[0] += p[0]; acc[1] += p[1]; return acc; }, [0,0]);
  return [m[0] / points.length, m[1] / points.length];
}

async function runLoop() {
  if (!run) return;
  const faces = await model.estimateFaces({ input: video, returnTensors: false, flipHorizontal: true });
  if (faces && faces.length > 0) {
    const f = faces[0];
    const lm = f.scaledMesh || f.landmarks || [];
    if (debugEl.checked) drawDebug(lm);

    // try to access annotated regions if available
    const annotations = f.annotations || {};
    const leftEye = annotations.leftEye || [];
    const rightEye = annotations.rightEye || [];
    const noseTip = annotations.noseTip || [];

    if (leftEye.length && rightEye.length && noseTip.length) {
      const eyeCenter = getPointMean([...leftEye.slice(0,3), ...rightEye.slice(0,3)]);
      const nose = getPointMean(noseTip.slice(0,3));
      const dy = (nose[1] - eyeCenter[1]) / overlay.height; // normalized

      // sensitivity slider: map value to threshold (lower threshold = easier to trigger)
      const sens = Number(sensitivityEl.value); // 1..100
      const threshold = 0.02 + (100 - sens) / 500; // approx 0.02..0.22

      if (dy > threshold && !cooldown) {
        slouchCounter++;
      } else {
        slouchCounter = Math.max(0, slouchCounter - 1);
      }

      if (slouchCounter > 3 && !cooldown) {
        try { await alertSound.play(); } catch (e) { /* play may fail if not allowed */ }
        cooldown = true;
        setTimeout(() => { cooldown = false; }, 4000);
        slouchCounter = 0;
      }
    }
  } else {
    ctx.clearRect(0,0,overlay.width,overlay.height);
  }
  requestAnimationFrame(runLoop);
}

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  stopBtn.disabled = false;
  await tf.ready();
  try {
    await setupCamera();
  } catch (e) {
    alert('Camera access denied or not available.');
    startBtn.disabled = false;
    stopBtn.disabled = true;
    return;
  }
  model = await faceLandmarksDetection.load(faceLandmarksDetection.SupportedPackages.mediapipeFacemesh);
  run = true;
  requestAnimationFrame(runLoop);
});

stopBtn.addEventListener('click', () => {
  run = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
  ctx && ctx.clearRect(0,0,overlay.width,overlay.height);
});

window.addEventListener('resize', () => {
  if (video.videoWidth) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  }
});
