

console.log('script.js loaded, DOM state', document.readyState);

const videoElement = document.getElementById('video');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
// sensitivity slider removed; we use a fixed value
// const sensitivityEl = document.getElementById('sensitivity');
const debugEl = document.getElementById('debug');
const alertSound = document.getElementById('alertSound');
const statusEl = document.getElementById('status');

let faceMesh = null;
let slouchCounter = 0;
let cooldown = false;
let isRunning = false;
let intervalId = null;
let silentAudio = null; // Background audio hack

// Keypoints indices
const NOSE_TIP = 1;
const LEFT_EYE_INNER = 33;
const LEFT_EYE_OUTER = 133;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_OUTER = 263;

function onResults(results) {
  if (!isRunning) return;

  // Ensure canvas matches video dimensions
  if (videoElement.videoWidth && (canvasElement.width !== videoElement.videoWidth)) {
      canvasElement.width = videoElement.videoWidth;
      canvasElement.height = videoElement.videoHeight;
  }

  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  
  // Draw debug points
  if (debugEl.checked && results.multiFaceLandmarks) {
    if (typeof drawConnectors === 'function' && typeof FACEMESH_TESSELATION !== 'undefined') {
        for (const landmarks of results.multiFaceLandmarks) {
            drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, {color: '#C0C0C070', lineWidth: 1});
            drawConnectors(canvasCtx, landmarks, FACEMESH_RIGHT_EYE, {color: '#FF3030'});
            drawConnectors(canvasCtx, landmarks, FACEMESH_RIGHT_EYEBROW, {color: '#FF3030'});
            drawConnectors(canvasCtx, landmarks, FACEMESH_LEFT_EYE, {color: '#30FF30'});
            drawConnectors(canvasCtx, landmarks, FACEMESH_LEFT_EYEBROW, {color: '#30FF30'});
            drawConnectors(canvasCtx, landmarks, FACEMESH_FACE_OVAL, {color: '#E0E0E0'});
            drawConnectors(canvasCtx, landmarks, FACEMESH_LIPS, {color: '#E0E0E0'});
        }
    } else {
        console.warn('drawConnectors or FACEMESH constants not found');
    }
  }
  
  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    const landmarks = results.multiFaceLandmarks[0];

    // Extract keypoints
    const nose = landmarks[NOSE_TIP];
    const leftEyeInner = landmarks[LEFT_EYE_INNER];
    const leftEyeOuter = landmarks[LEFT_EYE_OUTER];
    const rightEyeInner = landmarks[RIGHT_EYE_INNER];
    const rightEyeOuter = landmarks[RIGHT_EYE_OUTER];

    if (nose && leftEyeInner && leftEyeOuter && rightEyeInner && rightEyeOuter) {
       // Landmarks are normalized [0, 1]. No need to divide by height.
       const leftEyeY = (leftEyeInner.y + leftEyeOuter.y) / 2;
       const rightEyeY = (rightEyeInner.y + rightEyeOuter.y) / 2;
       const eyesMeanY = (leftEyeY + rightEyeY) / 2;
       
       const distance = nose.y - eyesMeanY; 
       // distance is relative to image height (0..1)
       
       // Fixed sensitivity (80% of max dial)
       const sens = 80; // value between 1 and 100
       // Map to threshold the same way as before
       const minThresh = 0.05;
       const maxThresh = 0.25;
       const threshold = maxThresh - ((sens / 100) * (maxThresh - minThresh));

       if (distance > threshold && !cooldown) {
         slouchCounter++;
       } else {
         slouchCounter = Math.max(0, slouchCounter - 1);
       }

       if (slouchCounter > 20 && !cooldown) {
           console.log("Slouch detected!", distance.toFixed(3), ">", threshold.toFixed(3));
           try { alertSound.play(); } catch(e){}
           cooldown = true;
           statusEl.textContent = "Upright, please!";
           statusEl.style.color = "#FF3030"; // red warning
           setTimeout(() => { 
               cooldown = false; 
               statusEl.textContent = "watching you...";
               statusEl.style.color = "#4B5CFF"; // accent
           }, 3000);
           slouchCounter = 0;
       } else if (slouchCounter > 0) {
           statusEl.textContent = `hmm... ${slouchCounter}`;
           statusEl.style.color = "#F59E0B"; // warning
       } else if (!cooldown) {
           statusEl.textContent = "all good";
           statusEl.style.color = "#22C55E"; // success
       }
    }
  } else {
      statusEl.textContent = "who dis?";
      statusEl.style.color = "#A1A5B2"; // secondary
  }
  canvasCtx.restore();
}

async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'user', width: 640, height: 480 }, 
        audio: false 
    });
    videoElement.srcObject = stream;
    return new Promise((resolve) => {
        videoElement.onloadedmetadata = () => {
            resolve();
        };
    });
}

async function processFrame() {
    if (!isRunning || !faceMesh || !videoElement.videoWidth) return;
    await faceMesh.send({image: videoElement});
}

startBtn.addEventListener('click', async () => {
  console.log('Start button pressed');
  statusEl.textContent = 'Initializing MediaPipe...';
  startBtn.disabled = true;
  stopBtn.disabled = false;
  
  try {
      faceMesh = new FaceMesh({locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/${file}`;
      }});
      
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      
      faceMesh.onResults(onResults);
      
      console.log('Starting camera...');
      await startCamera();
      await videoElement.play();

      // Sync overlay size
      canvasElement.width = videoElement.videoWidth;
      canvasElement.height = videoElement.videoHeight;
      

      isRunning = true;
      statusEl.textContent = 'MONITORING // ACTIVE';
      statusEl.style.color = '#4B5CFF';

      // Silent audio hack to keep background tab alive
      if (!silentAudio) {
        silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==');
        silentAudio.loop = true;
      }
      silentAudio.play().catch(e => console.warn("Silent audio play failed", e));
      
      // Use setInterval instead of requestAnimationFrame loop for background execution
      // 100ms = 10 FPS
      intervalId = setInterval(processFrame, 100);
      
  } catch (err) {
      console.error('Initialization failed:', err);
      statusEl.textContent = `ERROR: ${err.message}`;
      startBtn.disabled = false;
      stopBtn.disabled = true;
  }
});

stopBtn.addEventListener('click', () => {
  console.log('Stop button pressed');
  isRunning = false;
  
  if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
  }

  if (silentAudio) {
      silentAudio.pause();
      silentAudio.currentTime = 0;
  }
  
  const stream = videoElement.srcObject;
  if(stream) {
      stream.getTracks().forEach(t => t.stop());
      videoElement.srcObject = null;
  }
  
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusEl.textContent = 'stopped';
  statusEl.style.color = '#6B7280';
  canvasCtx.clearRect(0,0,canvasElement.width,canvasElement.height);
});
