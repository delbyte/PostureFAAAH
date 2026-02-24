
console.log('script.js loaded, DOM state', document.readyState);
window.addEventListener('error', (e) => {
  console.error('global error', e.message, e.filename, e.lineno, e.colno, e.error);
  if (statusEl) statusEl.textContent = `Error: ${e.message}`;
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('unhandled promise rejection', e.reason);
  if (statusEl) statusEl.textContent = `Error: ${e.reason}`;
});

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const sensitivityEl = document.getElementById('sensitivity');
const debugEl = document.getElementById('debug');
const alertSound = document.getElementById('alertSound');
const statusEl = document.getElementById('status');

let detector = null;
let run = false;
let stream = null;
let slouchCounter = 0;
let cooldown = false;

// MediaPipe Face Mesh Keypoints
const KEYPOINT_NOSE_TIP = 1;
const KEYPOINT_LEFT_EYE_INNER = 33;
const KEYPOINT_LEFT_EYE_OUTER = 133;
const KEYPOINT_RIGHT_EYE_INNER = 362;
const KEYPOINT_RIGHT_EYE_OUTER = 263;

async function setupCamera() {
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
  video.srcObject = stream;
  await new Promise((r) => (video.onloadedmetadata = r));
  video.play();
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
}

function drawDebug(keypoints) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!keypoints) return;
  
  ctx.fillStyle = 'lime';
  for (const p of keypoints) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Highlight key features
  ctx.fillStyle = 'red';
  [KEYPOINT_NOSE_TIP, KEYPOINT_LEFT_EYE_INNER, KEYPOINT_LEFT_EYE_OUTER, KEYPOINT_RIGHT_EYE_INNER, KEYPOINT_RIGHT_EYE_OUTER].forEach(idx => {
      const p = keypoints[idx];
      if(p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
  });
}

async function runLoop() {
  if (!run || !detector) return;
  
  try {
    const faces = await detector.estimateFaces(video, { flipHorizontal: false }); // flipHorizontal handled by CSS or logic if needed, but standard is false for raw data
    
    // We want mirror effect for user, so usually we flip video with CSS and keypoints logic
    // But estimateFaces has flipHorizontal option. If true, keypoints are flipped.
    // Let's use flipHorizontal: false and just mirror the video element with CSS.
    // Wait, drawing on canvas needs to match. If we flip video with CSS, we should flip context or inputs.
    // Let's stick to standard: input not flipped, draw heavily.
    // Actually, for user facing camera, flipHorizontal: true is better for the "mirror" feel in coordinates.
    
    if (faces && faces.length > 0) {
      const face = faces[0];
      const keypoints = face.keypoints;
      
      if (debugEl.checked) drawDebug(keypoints);
      else ctx.clearRect(0, 0, overlay.width, overlay.height);

      const nose = keypoints[KEYPOINT_NOSE_TIP];
      const leftEyeInner = keypoints[KEYPOINT_LEFT_EYE_INNER];
      const leftEyeOuter = keypoints[KEYPOINT_LEFT_EYE_OUTER];
      const rightEyeInner = keypoints[KEYPOINT_RIGHT_EYE_INNER];
      const rightEyeOuter = keypoints[KEYPOINT_RIGHT_EYE_OUTER];

      if (nose && leftEyeInner && leftEyeOuter && rightEyeInner && rightEyeOuter) {
        const leftEyeY = (leftEyeInner.y + leftEyeOuter.y) / 2;
        const rightEyeY = (rightEyeInner.y + rightEyeOuter.y) / 2;
        const eyesMeanY = (leftEyeY + rightEyeY) / 2;
        
        const distance = nose.y - eyesMeanY;
        const normalizedDistance = distance / overlay.height;

        // Sensitivity logic
        const sens = Number(sensitivityEl.value);
        // Map 1..100 to a threshold.
        // Good posture: nose is roughly level with ears/eyes or slightly below.
        // Slouching (head down): nose drops significantly below eyes.
        // Or slouching (leaning forward): face gets larger?
        // Usually "text neck" or slouching means head tilts down, so nose Y increases relative to eyes Y.
        
        // Threshold: 
        // High sensitivity (100) -> small threshold (detects slight slouch)
        // Low sensitivity (1) -> large threshold (only detects deep slouch)
        const minThresh = 0.05;
        const maxThresh = 0.25;
        const threshold = maxThresh - ((sens / 100) * (maxThresh - minThresh));

        if (normalizedDistance > threshold && !cooldown) {
          slouchCounter++;
        } else {
          slouchCounter = Math.max(0, slouchCounter - 1);
        }

        if (slouchCounter > 20 && !cooldown) { // Require sustained slouch (~0.5-1s)
            try { 
                await alertSound.play(); 
            } catch (e) { console.warn("Audio play failed", e); }
            
            cooldown = true;
            statusEl.textContent = "Slouch detected!";
            statusEl.style.color = "red";
            setTimeout(() => { 
                cooldown = false; 
                statusEl.textContent = "Monitoring...";
                statusEl.style.color = "lime";
            }, 3000);
            slouchCounter = 0;
        } else if (slouchCounter > 0) {
            statusEl.textContent = `Warning... ${slouchCounter}`;
            statusEl.style.color = "orange";
        } else if (!cooldown) {
            statusEl.textContent = "Good posture";
            statusEl.style.color = "lime";
        }
      }
    } else {
      ctx.clearRect(0,0,overlay.width,overlay.height);
      statusEl.textContent = "No face detected";
      statusEl.style.color = "white";
    }
  } catch (err) {
      console.error("Detection error:", err);
  }
  
  if(run) requestAnimationFrame(runLoop);
}

startBtn.addEventListener('click', async () => {
  console.log('start button pressed');
  statusEl.textContent = 'Initializing…';
  startBtn.disabled = true;
  stopBtn.disabled = false;
  
  try {
    await tf.ready();
    await setupCamera();
    
    // Create detector
    const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
    const detectorConfig = {
      runtime: 'tfjs',
      refineLandmarks: true,
      maxFaces: 1
    };
    detector = await faceLandmarksDetection.createDetector(model, detectorConfig);
    
    statusEl.textContent = 'Monitoring...';
    statusEl.style.color = 'lime';
    run = true;
    requestAnimationFrame(runLoop);
    
  } catch (err) {
    console.error('Initialization failed', err);
    statusEl.textContent = `Error: ${err.message}`;
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
});

stopBtn.addEventListener('click', () => {
  run = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusEl.textContent = 'Stopped';
  statusEl.style.color = 'white';
  
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
