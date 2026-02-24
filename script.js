

console.log('script.js loaded, DOM state', document.readyState);

const videoElement = document.getElementById('video');
const canvasElement = document.getElementById('overlay');
const canvasCtx = canvasElement.getContext('2d');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const sensitivityEl = document.getElementById('sensitivity');
const debugEl = document.getElementById('debug');
const alertSound = document.getElementById('alertSound');
const statusEl = document.getElementById('status');

let camera = null;
let faceMesh = null;
let slouchCounter = 0;
let cooldown = false;
let isRunning = false;

// Keypoints indices
const NOSE_TIP = 1;
const LEFT_EYE_INNER = 33;
const LEFT_EYE_OUTER = 133;
const RIGHT_EYE_INNER = 362;
const RIGHT_EYE_OUTER = 263;

function onResults(results) {
  if (!isRunning) return;

  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  
  // Draw video frame to canvas if needed, or just overlays. 
  // Since video element is behind canvas, we just draw overlays.
  
  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    const landmarks = results.multiFaceLandmarks[0];
    
    // Draw debug points
    if (debugEl.checked) {
        // Draw mesh
        drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, {color: '#C0C0C070', lineWidth: 1});
        drawConnectors(canvasCtx, landmarks, FACEMESH_RIGHT_EYE, {color: '#FF3030'});
        drawConnectors(canvasCtx, landmarks, FACEMESH_RIGHT_EYEBROW, {color: '#FF3030'});
        drawConnectors(canvasCtx, landmarks, FACEMESH_LEFT_EYE, {color: '#30FF30'});
        drawConnectors(canvasCtx, landmarks, FACEMESH_LEFT_EYEBROW, {color: '#30FF30'});
        drawConnectors(canvasCtx, landmarks, FACEMESH_FACE_OVAL, {color: '#E0E0E0'});
        drawConnectors(canvasCtx, landmarks, FACEMESH_LIPS, {color: '#E0E0E0'});
    }

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
       
       // Sensitivity logic
       const sens = Number(sensitivityEl.value);
       // Map 1..100 -> threshold
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
      statusEl.textContent = "No face detected";
      statusEl.style.color = "white";
  }
  canvasCtx.restore();
}

startBtn.addEventListener('click', async () => {
  console.log('Start button pressed');
  statusEl.textContent = 'Initializing MediaPipe...';
  startBtn.disabled = true;
  stopBtn.disabled = false;
  
  try {
      faceMesh = new FaceMesh({locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
      }});
      
      faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });
      
      faceMesh.onResults(onResults);
      
      camera = new Camera(videoElement, {
        onFrame: async () => {
          if (isRunning) await faceMesh.send({image: videoElement});
        },
        width: 640,
        height: 480
      });
      
      console.log('Starting camera...');
      await camera.start();
      
      isRunning = true;
      statusEl.textContent = 'Monitoring...';
      statusEl.style.color = 'lime';
      
      // Sync overlay size
      videoElement.addEventListener('loadedmetadata', () => {
          canvasElement.width = videoElement.videoWidth;
          canvasElement.height = videoElement.videoHeight;
      });
      
  } catch (err) {
      console.error('Initialization failed:', err);
      statusEl.textContent = `Error: ${err.message}`;
      startBtn.disabled = false;
      stopBtn.disabled = true;
  }
});

stopBtn.addEventListener('click', () => {
  console.log('Stop button pressed');
  isRunning = false;
  if (camera) {
      camera.stop(); // Camera utility doesn't have stop(), but we stop processing
      // Actually Camera utils start() returns promise, no explicit stop() method in some versions, 
      // but usually we just stop calling send().
      // Let's stop the tracks manually to be safe.
      const stream = videoElement.srcObject;
      if(stream) stream.getTracks().forEach(t => t.stop());
      videoElement.srcObject = null;
  }
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statusEl.textContent = 'Stopped';
  statusEl.style.color = 'white';
  canvasCtx.clearRect(0,0,canvasElement.width,canvasElement.height);
});
