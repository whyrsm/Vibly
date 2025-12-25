// Vibly Background Service Worker
// Handles extension state and messaging between popup and content scripts

let recordingState = {
  isRecording: false,
  isPaused: false,
  startTime: null,
  duration: 0
};

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'GET_STATE':
      sendResponse(recordingState);
      break;
    case 'UPDATE_STATE':
      recordingState = { ...recordingState, ...message.payload };
      break;
    case 'RESET_STATE':
      recordingState = {
        isRecording: false,
        isPaused: false,
        startTime: null,
        duration: 0
      };
      break;
  }
  return true;
});

// Keep service worker alive during recording
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepAlive') {
    port.onDisconnect.addListener(() => {
      // Reconnect if needed
    });
  }
});
