import { MediaHandler } from '../lib/media-handler.js';
import { Compositor } from '../lib/compositor.js';
import { MAX_RECORDING_DURATION, RecordingState } from '../config/constants.js';

class ViblyPopup {
  constructor() {
    this.mediaHandler = new MediaHandler();
    this.compositor = new Compositor();
    this.state = RecordingState.IDLE;
    this.recordingBlob = null;
    this.timerInterval = null;
    this.startTime = null;
    this.pausedTime = 0;
    this.elapsedSeconds = 0;
    
    this.initElements();
    this.bindEvents();
  }

  initElements() {
    // States
    this.idleState = document.getElementById('idle-state');
    this.recordingState = document.getElementById('recording-state');
    this.processingState = document.getElementById('processing-state');
    this.completeState = document.getElementById('complete-state');
    this.errorState = document.getElementById('error-state');
    
    // Controls
    this.startBtn = document.getElementById('start-btn');
    this.pauseBtn = document.getElementById('pause-btn');
    this.stopBtn = document.getElementById('stop-btn');
    this.downloadBtn = document.getElementById('download-btn');
    this.newRecordingBtn = document.getElementById('new-recording-btn');
    this.retryBtn = document.getElementById('retry-btn');
    
    // Options
    this.webcamToggle = document.getElementById('webcam-toggle');
    this.micToggle = document.getElementById('mic-toggle');
    
    // Display
    this.timer = document.getElementById('timer');
    this.timerContainer = document.querySelector('.timer-container');
    this.errorMessage = document.getElementById('error-message');
  }

  bindEvents() {
    this.startBtn.addEventListener('click', () => this.startRecording());
    this.pauseBtn.addEventListener('click', () => this.togglePause());
    this.stopBtn.addEventListener('click', () => this.stopRecording());
    this.downloadBtn.addEventListener('click', () => this.downloadRecording());
    this.newRecordingBtn.addEventListener('click', () => this.reset());
    this.retryBtn.addEventListener('click', () => this.reset());
  }

  async startRecording() {
    try {
      // Request screen capture first
      const screenStream = await this.mediaHandler.requestScreenCapture();
      
      // Now update UI state
      this.setState(RecordingState.RECORDING);
      
      // Handle screen share stop (user clicks "Stop sharing")
      screenStream.getVideoTracks()[0].onended = () => {
        if (this.state === RecordingState.RECORDING) {
          this.stopRecording();
        }
      };
      
      // Request webcam if enabled
      let webcamStream = null;
      if (this.webcamToggle.checked) {
        webcamStream = await this.compositor.requestWebcamCapture();
      }
      
      // Request microphone if enabled
      let micStream = null;
      if (this.micToggle.checked) {
        micStream = await this.mediaHandler.requestMicrophoneCapture();
      }
      
      let finalStream;
      
      if (webcamStream) {
        // Use compositor for webcam overlay
        await this.compositor.initialize(screenStream, webcamStream);
        this.compositor.start();
        const compositedStream = this.compositor.getOutputStream();
        finalStream = this.mediaHandler.combineStreams(compositedStream, micStream);
      } else {
        // No webcam - use screen stream directly with audio
        finalStream = this.mediaHandler.combineStreams(screenStream, micStream);
      }
      
      // Start recording
      const recorder = this.mediaHandler.startRecording(finalStream);
      
      // Log for debugging
      console.log('Recording started', {
        state: recorder.state,
        mimeType: recorder.mimeType,
        hasVideo: finalStream.getVideoTracks().length > 0,
        hasAudio: finalStream.getAudioTracks().length > 0
      });
      
      // Start timer
      this.startTimer();
      
    } catch (error) {
      console.error('Recording error:', error);
      this.showError(this.getErrorMessage(error));
    }
  }

  togglePause() {
    if (this.mediaHandler.getRecordingState() === 'recording') {
      this.mediaHandler.pauseRecording();
      this.pauseBtn.textContent = 'Resume';
      this.timerContainer.classList.add('paused');
      this.pauseTimer();
    } else {
      this.mediaHandler.resumeRecording();
      this.pauseBtn.textContent = 'Pause';
      this.timerContainer.classList.remove('paused');
      this.resumeTimer();
    }
  }

  async stopRecording() {
    // Prevent double-stop
    if (this.state !== RecordingState.RECORDING) return;
    
    this.setState(RecordingState.PROCESSING);
    this.stopTimer();
    
    try {
      // Request final data before stopping
      if (this.mediaHandler.mediaRecorder && 
          this.mediaHandler.mediaRecorder.state === 'recording') {
        this.mediaHandler.mediaRecorder.requestData();
      }
      
      // Small delay to ensure data is captured
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Stop compositor if running
      this.compositor.stop();
      
      // Stop recording and get blob
      this.recordingBlob = await this.mediaHandler.stopRecording();
      
      console.log('Recording stopped', {
        blobSize: this.recordingBlob?.size,
        chunksCount: this.mediaHandler.recordedChunks?.length
      });
      
      // Cleanup streams
      this.mediaHandler.cleanup();
      this.compositor.cleanup();
      
      if (this.recordingBlob && this.recordingBlob.size > 0) {
        this.setState(RecordingState.COMPLETE);
      } else {
        this.showError('Recording failed - no data captured');
      }
    } catch (error) {
      console.error('Stop recording error:', error);
      this.showError('Failed to process recording');
    }
  }

  downloadRecording() {
    if (!this.recordingBlob || this.recordingBlob.size === 0) {
      console.error('No recording data to download');
      return;
    }
    
    const url = URL.createObjectURL(this.recordingBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vibly-recording-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    // Delay revoking to ensure download starts
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  reset() {
    this.recordingBlob = null;
    this.elapsedSeconds = 0;
    this.pausedTime = 0;
    this.timer.textContent = '00:00';
    this.timerContainer?.classList.remove('paused');
    this.pauseBtn.textContent = 'Pause';
    this.setState(RecordingState.IDLE);
  }

  // Timer methods
  startTimer() {
    this.startTime = Date.now();
    this.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000) + this.pausedTime;
      this.elapsedSeconds = elapsed;
      this.updateTimerDisplay(elapsed);
      
      // Auto-stop at max duration
      if (elapsed >= MAX_RECORDING_DURATION) {
        this.stopRecording();
      }
    }, 1000);
  }

  pauseTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.pausedTime = this.elapsedSeconds;
    }
  }

  resumeTimer() {
    this.startTime = Date.now();
    this.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000) + this.pausedTime;
      this.elapsedSeconds = elapsed;
      this.updateTimerDisplay(elapsed);
      
      if (elapsed >= MAX_RECORDING_DURATION) {
        this.stopRecording();
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  updateTimerDisplay(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    this.timer.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // State management
  setState(newState) {
    this.state = newState;
    
    // Hide all states
    this.idleState.classList.add('hidden');
    this.recordingState.classList.add('hidden');
    this.processingState.classList.add('hidden');
    this.completeState.classList.add('hidden');
    this.errorState.classList.add('hidden');
    
    // Show current state
    switch (newState) {
      case RecordingState.IDLE:
        this.idleState.classList.remove('hidden');
        break;
      case RecordingState.RECORDING:
        this.recordingState.classList.remove('hidden');
        break;
      case RecordingState.PROCESSING:
        this.processingState.classList.remove('hidden');
        break;
      case RecordingState.COMPLETE:
        this.completeState.classList.remove('hidden');
        break;
      case RecordingState.ERROR:
        this.errorState.classList.remove('hidden');
        break;
    }
  }

  showError(message) {
    this.errorMessage.textContent = message;
    this.setState(RecordingState.ERROR);
    
    // Cleanup on error
    this.mediaHandler.cleanup();
    this.compositor.cleanup();
    this.stopTimer();
  }

  getErrorMessage(error) {
    if (error.message === 'SCREEN_PERMISSION_DENIED') {
      return 'Screen access denied. Click to try again.';
    }
    if (error.name === 'NotAllowedError') {
      return 'Permission denied. Please allow access and try again.';
    }
    if (error.name === 'NotFoundError') {
      return 'No screen or camera found.';
    }
    if (error.name === 'NotSupportedError') {
      return 'Your browser doesn\'t support recording.';
    }
    return 'Something went wrong. Please try again.';
  }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  new ViblyPopup();
});
