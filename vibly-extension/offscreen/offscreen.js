// Offscreen document for persistent recording
// This runs in a hidden document that persists even when popup closes

import { VIDEO_BITRATE, VIDEO_FRAMERATE, WEBCAM_SIZE_RATIO } from '../config/constants.js';

let mediaRecorder = null;
let recordedChunks = [];
let screenStream = null;
let webcamStream = null;
let micStream = null;
let audioContext = null;
let canvas = null;
let compositorRunning = false;
let animationId = null;

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle messages targeted at offscreen
  if (message.target !== 'offscreen') {
    return false;
  }

  console.log('[Offscreen] Received message:', message.type);

  switch (message.type) {
    case 'START_RECORDING':
      startRecording(message.payload)
        .then((result) => sendResponse({ success: true, data: result }))
        .catch((error) => {
          console.error('[Offscreen] Start recording error:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;

    case 'STOP_RECORDING':
      stopRecording()
        .then((result) => sendResponse({ success: true, data: result }))
        .catch((error) => {
          console.error('[Offscreen] Stop recording error:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;

    case 'PAUSE_RECORDING':
      pauseRecording();
      sendResponse({ success: true });
      break;

    case 'RESUME_RECORDING':
      resumeRecording();
      sendResponse({ success: true });
      break;

    case 'GET_RECORDING_STATE':
      sendResponse({
        isRecording: mediaRecorder?.state === 'recording',
        isPaused: mediaRecorder?.state === 'paused',
        chunksCount: recordedChunks.length,
      });
      break;
  }
});

async function startRecording(options) {
  console.log('[Offscreen] Starting recording with options:', options);

  recordedChunks = [];

  // Get screen stream
  screenStream = await navigator.mediaDevices.getDisplayMedia({
    video: { cursor: 'always' },
    audio: true,
  });

  // Handle user stopping screen share
  screenStream.getVideoTracks()[0].onended = () => {
    console.log('[Offscreen] Screen share ended by user');
    chrome.runtime.sendMessage({ type: 'SCREEN_SHARE_ENDED' });
  };

  let finalStream;

  // Get webcam if requested
  if (options.includeWebcam) {
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });
      // Use compositor for webcam overlay
      finalStream = await setupCompositor(screenStream, webcamStream);
    } catch (e) {
      console.warn('[Offscreen] Webcam not available:', e);
      finalStream = screenStream;
    }
  } else {
    finalStream = screenStream;
  }

  // Get microphone if requested
  if (options.includeMic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      console.warn('[Offscreen] Microphone not available:', e);
    }
  }

  // Combine audio streams
  const combinedStream = combineStreams(finalStream, micStream);

  // Start MediaRecorder
  const mimeType = getSupportedMimeType();
  mediaRecorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: VIDEO_BITRATE,
  });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data);
      console.log('[Offscreen] Chunk captured:', event.data.size, 'bytes, total:', recordedChunks.length);
    }
  };

  mediaRecorder.onerror = (event) => {
    console.error('[Offscreen] MediaRecorder error:', event.error);
    chrome.runtime.sendMessage({ type: 'RECORDING_ERROR', error: event.error?.message });
  };

  mediaRecorder.start(1000); // Capture every second
  console.log('[Offscreen] MediaRecorder started');

  return { status: 'recording' };
}

async function setupCompositor(screenStream, webcamStream) {
  canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const videoTrack = screenStream.getVideoTracks()[0];
  const settings = videoTrack.getSettings();
  canvas.width = settings.width || 1920;
  canvas.height = settings.height || 1080;

  const screenVideo = document.createElement('video');
  screenVideo.srcObject = screenStream;
  screenVideo.muted = true;
  await screenVideo.play();

  const webcamVideo = document.createElement('video');
  webcamVideo.srcObject = webcamStream;
  webcamVideo.muted = true;
  await webcamVideo.play();

  compositorRunning = true;

  function composite() {
    if (!compositorRunning) return;

    // Draw screen
    ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);

    // Draw webcam overlay (bottom-right)
    if (webcamStream?.active) {
      const webcamWidth = canvas.width * WEBCAM_SIZE_RATIO;
      const webcamHeight = webcamWidth * 0.75;
      const x = canvas.width - webcamWidth - 20;
      const y = canvas.height - webcamHeight - 20;

      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, webcamWidth, webcamHeight, 12);
      ctx.clip();
      ctx.drawImage(webcamVideo, x, y, webcamWidth, webcamHeight);
      ctx.restore();

      // Border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(x, y, webcamWidth, webcamHeight, 12);
      ctx.stroke();
    }

    animationId = requestAnimationFrame(composite);
  }

  composite();

  return canvas.captureStream(VIDEO_FRAMERATE);
}

function combineStreams(videoStream, micStream) {
  const tracks = [];

  // Video track
  const videoTrack = videoStream.getVideoTracks()[0];
  if (videoTrack) tracks.push(videoTrack);

  // Combine audio
  audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  // System audio from screen
  const screenAudioTracks = videoStream.getAudioTracks();
  if (screenAudioTracks.length > 0) {
    const source = audioContext.createMediaStreamSource(new MediaStream([screenAudioTracks[0]]));
    source.connect(destination);
  }

  // Microphone audio
  if (micStream) {
    const micSource = audioContext.createMediaStreamSource(micStream);
    micSource.connect(destination);
  }

  const audioTrack = destination.stream.getAudioTracks()[0];
  if (audioTrack) tracks.push(audioTrack);

  return new MediaStream(tracks);
}

function getSupportedMimeType() {
  const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'video/webm';
}

function pauseRecording() {
  if (mediaRecorder?.state === 'recording') {
    mediaRecorder.pause();
    console.log('[Offscreen] Recording paused');
  }
}

function resumeRecording() {
  if (mediaRecorder?.state === 'paused') {
    mediaRecorder.resume();
    console.log('[Offscreen] Recording resumed');
  }
}

async function stopRecording() {
  console.log('[Offscreen] Stopping recording');

  return new Promise((resolve, reject) => {
    if (!mediaRecorder) {
      reject(new Error('No active recording'));
      return;
    }

    mediaRecorder.onstop = async () => {
      console.log('[Offscreen] MediaRecorder stopped, chunks:', recordedChunks.length);

      // Stop compositor
      compositorRunning = false;
      if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }

      // Create blob
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      console.log('[Offscreen] Blob created, size:', blob.size);

      // Convert to base64 for transfer (or use a different method for large files)
      let blobData = null;
      if (blob.size < 50 * 1024 * 1024) {
        // Only convert if < 50MB
        const arrayBuffer = await blob.arrayBuffer();
        blobData = Array.from(new Uint8Array(arrayBuffer));
      }

      // Cleanup
      cleanup();

      resolve({
        blobSize: blob.size,
        chunksCount: recordedChunks.length,
        blobData: blobData,
      });
    };

    // Request final data
    if (mediaRecorder.state !== 'inactive') {
      mediaRecorder.requestData();
      mediaRecorder.stop();
    } else {
      // Already stopped
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      cleanup();
      resolve({ blobSize: blob.size, chunksCount: recordedChunks.length });
    }
  });
}

function cleanup() {
  console.log('[Offscreen] Cleaning up');

  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }
  if (webcamStream) {
    webcamStream.getTracks().forEach((t) => t.stop());
    webcamStream = null;
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  mediaRecorder = null;
  recordedChunks = [];
}

console.log('[Offscreen] Document loaded');
