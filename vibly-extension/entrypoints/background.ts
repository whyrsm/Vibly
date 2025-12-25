export default defineBackground(() => {
  let recordingState = {
    isRecording: false,
    isPaused: false,
    startTime: null as number | null,
  };

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'GET_STATE':
        sendResponse(recordingState);
        break;
      case 'SET_RECORDING':
        recordingState.isRecording = message.isRecording;
        recordingState.startTime = message.isRecording ? Date.now() : null;
        sendResponse({ success: true });
        break;
      case 'SET_PAUSED':
        recordingState.isPaused = message.isPaused;
        sendResponse({ success: true });
        break;
    }
    return true;
  });

  console.log('[Vibly] Background service worker loaded');
});
