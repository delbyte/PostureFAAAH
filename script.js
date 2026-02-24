
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
let lastLog = 0;

// MediaPipe Face Mesh Keypoints
const KEYPOINT_NOSE_TIP = 1;
const KEYPOINT_LEFT_EYE_INNER = 33;
const KEYPOINT_LEFT_EYE_OUTER = 133;
const KEYPOINT_RIGHT_EYE_INNER = 362;
const KEYPOINT_RIGHT_EYE_OUTER = 263;

async function setupCamera() {
  console.log('Setting up camera...');
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
  console.log('Stream acquired:', stream.id);
  video.srcObject = stream;
  await new Promise((r) => (video.onloadedmetadata = r));
  console.log('Video metadata loaded. Dimensions:', video.videoWidth, 'x', video.videoHeight);
  video.play();
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  console.log('Overlay dimensions set:', overlay.width, 'x', overlay.height);
}

function drawDebug(keypoints) {
  // Clear canvas for fresh draw
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  
  if (!keypoints) {
    console.warn('drawDebug called with no keypoints');
    return;
  }
  
  // Draw all keypoints in green
  ctx.fillStyle = 'lime';
  for (const p of keypoints) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // Highlight key features in red
  ctx.fillStyle = 'red';
  const importantIndices = [KEYPOINT_NOSE_TIP, KEYPOINT_LEFT_EYE_INNER, KEYPOINT_LEFT_EYE_OUTER, KEYPOINT_RIGHT_EYE_INNER, KEYPOINT_RIGHT_EYE_OUTER];
  
  importantIndices.forEach(idx => {
      const p = keypoints[idx];
      if(p) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
  });
}

async function runLoop() {
  if (!run) return;
  if (!detector) {
    console.warn('Detector not ready yet');
    requestAnimationFrame(runLoop);
    return;
  }
  
  try {
    const now = Date.now();
    // Log every 2 seconds to avoid spamming console
    const shouldLog = (now - lastLog > 2000);

    if (shouldLog) console.log('Running detection...');
    
    // Check video state
    if (video.readyState < 2) {
      if (shouldLog) console.log('Video not ready yet (readyState:', video.readyState, ')');
      requestAnimationFrame(runLoop);
      return;
    }

    const faces = await detector.estimateFaces(video, { flipHorizontal: false });
    
    if (shouldLog) {
       console.log(`Detected ${faces.length} faces.`);
       lastLog = now;
    }

    if (faces && faces.length > 0) {
      const face = faces[0];
      const keypoints = face.keypoints;
      
      if (debugEl.checked) {
          drawDebug(keypoints);
      } else {
          ctx.clearRect(0, 0, overlay.width, overlay.height);
      }

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
        const minThresh = 0.05;
        const maxThresh = 0.25;
        const threshold = maxThresh - ((sens / 100) * (maxThresh - minThresh));

        if (normalizedDistance > threshold && !cooldown) {
          slouchCounter++;
        } else {
          slouchCounter = Math.max(0, slouchCounter - 1);
        }

        if (slouchCounter > 20 && !cooldown) {
            console.log('Slouch triggered! Count:', slouchCounter);
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
      console.error("Detection error in runLoop:", err);
  }
  
  if(run) requestAnimationFrame(runLoop);
}

startBtn.addEventListener('click', async () => {
  console.log('Start button pressed');
  statusEl.textContent = 'Initializing…';
  startBtn.disabled = true;
  stopBtn.disabled = false;
  
  try {
    console.log('Waiting for tf.ready()...');
    await tf.ready();
    console.log('tf.ready() complete. Backend:', tf.getBackend());
    
    await setupCamera();
    
    console.log('Creating detector...');
    const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
    const detectorConfig = {
      runtime: 'tfjs', // specific runtime
      refineLandmarks: true,
      maxFaces: 1
    };
    detector = await faceLandmarksDetection.createDetector(model, detectorConfig);
    console.log('Detector created successfully:', detector);
    
    statusEl.textContent = 'Monitoring...';
    statusEl.style.color = 'lime';
    run = true;
    requestAnimationFrame(runLoop);
    
  } catch (err) {
    console.error('Initialization failed:', err);
    statusEl.textContent = `Error: ${err.message}`;
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
});

stopBtn.addEventListener('click', () => {
  console.log('Stop button pressed');
  run = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusEl.textContent = 'Stopped';
  statusEl.style.color = 'white';
  
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
    console.log('Camera stream stopped');
  }
  ctx && ctx.clearRect(0,0,overlay.width,overlay.height);
});

window.addEventListener('resize', () => {
  if (video.videoWidth) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    console.log('Resized overlay to:', overlay.width, 'x', overlay.height);
  }
});
