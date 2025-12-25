// Vibly Background Service Worker
// Manages offscreen document for persistent recording

let recordingState = {
  isRecording: false,
  isPaused: false,
  startTime: null,
  blobData: null,
};

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

// Check if offscreen document exists
async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  return contexts.length > 0;
}

// Create offscreen document
async function createOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    console.log('[SW] Offscreen document already exists');
    return;
  }

  console.log('[SW] Creating offscreen document');
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'],
    justification: 'Recording screen and webcam',
  });
  
  // Wait for document to be ready
  await new Promise(resolve => setTimeout(resolve, 100));
}

// Close offscreen document
async function closeOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    console.log('[SW] Closing offscreen document');
    await chrome.offscreen.closeDocument();
  }
}

// Send message to offscreen document
async function sendToOffscreen(message) {
  await createOffscreenDocument();
  
  // Add target to distinguish from popup messages
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ ...message, target: 'offscreen' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Ignore messages meant for offscreen document
  if (message.target === 'offscreen') {
    return false;
  }

  console.log('[SW] Received message:', message.type);

  // Messages from offscreen document
  if (message.type === 'SCREEN_SHARE_ENDED') {
    recordingState.isRecording = false;
    return;
  }

  if (message.type === 'RECORDING_ERROR') {
    recordingState.isRecording = false;
    return;
  }

  // Messages from popup
  switch (message.type) {
    case 'GET_STATE':
      sendResponse({
        isRecording: recordingState.isRecording,
        isPaused: recordingState.isPaused,
        startTime: recordingState.startTime,
      });
      break;

    case 'START_RECORDING':
      handleStartRecording(message.payload)
        .then((result) => sendResponse({ success: true, data: result }))
        .catch((error) => {
          console.error('[SW] Start error:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;

    case 'STOP_RECORDING':
      handleStopRecording()
        .then((result) => sendResponse({ success: true, data: result }))
        .catch((error) => {
          console.error('[SW] Stop error:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true;

    case 'PAUSE_RECORDING':
      handlePauseRecording()
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;

    case 'RESUME_RECORDING':
      handleResumeRecording()
        .then(() => sendResponse({ success: true }))
        .catch((error) => sendResponse({ success: false, error: error.message }));
      return true;
  }
});

async function handleStartRecording(options) {
  console.log('[SW] Starting recording with options:', options);

  try {
    const response = await sendToOffscreen({
      type: 'START_RECORDING',
      payload: options,
    });

    console.log('[SW] Offscreen response:', response);

    if (response && response.success) {
      recordingState.isRecording = true;
      recordingState.isPaused = false;
      recordingState.startTime = Date.now();
      return response;
    } else {
      throw new Error(response?.error || 'Failed to start recording in offscreen');
    }
  } catch (error) {
    console.error('[SW] handleStartRecording error:', error);
    throw error;
  }
}

async function handleStopRecording() {
  console.log('[SW] Stopping recording');

  try {
    const response = await sendToOffscreen({ type: 'STOP_RECORDING' });

    recordingState.isRecording = false;
    recordingState.isPaused = false;

    if (response && response.success && response.data) {
      recordingState.blobData = response.data.blobData;
      const duration = Math.floor((Date.now() - recordingState.startTime) / 1000);
      response.data.duration = duration;
    }

    // Close offscreen document after recording
    await closeOffscreenDocument();

    return response;
  } catch (error) {
    console.error('[SW] handleStopRecording error:', error);
    throw error;
  }
}

async function handlePauseRecording() {
  const response = await sendToOffscreen({ type: 'PAUSE_RECORDING' });
  if (response && response.success) {
    recordingState.isPaused = true;
  }
  return response;
}

async function handleResumeRecording() {
  const response = await sendToOffscreen({ type: 'RESUME_RECORDING' });
  if (response && response.success) {
    recordingState.isPaused = false;
  }
  return response;
}

console.log('[SW] Service worker loaded');
