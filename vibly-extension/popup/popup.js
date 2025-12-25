import { apiClient } from '../lib/api-client.js';
import { uploader } from '../lib/uploader.js';
import { MAX_RECORDING_DURATION, RecordingState } from '../config/constants.js';

class ViblyPopup {
  constructor() {
    this.state = RecordingState.IDLE;
    this.recordingBlob = null;
    this.timerInterval = null;
    this.startTime = null;
    this.pausedTime = 0;
    this.elapsedSeconds = 0;
    this.shareUrl = null;
    this.isGuest = false;
    this.authMode = 'login';

    this.initElements();
    this.bindEvents();
    this.checkState();
  }

  initElements() {
    // States
    this.authState = document.getElementById('auth-state');
    this.idleState = document.getElementById('idle-state');
    this.recordingState = document.getElementById('recording-state');
    this.processingState = document.getElementById('processing-state');
    this.uploadingState = document.getElementById('uploading-state');
    this.completeState = document.getElementById('complete-state');
    this.errorState = document.getElementById('error-state');

    // Auth elements
    this.authForm = document.getElementById('auth-form');
    this.emailInput = document.getElementById('email');
    this.passwordInput = document.getElementById('password');
    this.authSubmit = document.getElementById('auth-submit');
    this.authError = document.getElementById('auth-error');
    this.tabs = document.querySelectorAll('.tab');
    this.skipAuthBtn = document.getElementById('skip-auth-btn');
    this.logoutBtn = document.getElementById('logout-btn');
    this.userInfo = document.getElementById('user-info');

    // Recording controls
    this.startBtn = document.getElementById('start-btn');
    this.pauseBtn = document.getElementById('pause-btn');
    this.stopBtn = document.getElementById('stop-btn');
    this.downloadBtn = document.getElementById('download-btn');
    this.newRecordingBtn = document.getElementById('new-recording-btn');
    this.retryBtn = document.getElementById('retry-btn');
    this.copyLinkBtn = document.getElementById('copy-link-btn');

    // Options
    this.webcamToggle = document.getElementById('webcam-toggle');
    this.micToggle = document.getElementById('mic-toggle');

    // Display
    this.timer = document.getElementById('timer');
    this.timerContainer = document.querySelector('.timer-container');
    this.errorMessage = document.getElementById('error-message');
    this.uploadProgress = document.getElementById('upload-progress');
    this.uploadStatus = document.getElementById('upload-status');
    this.shareLink = document.getElementById('share-link');
    this.shareLinkContainer = document.getElementById('share-link-container');
  }

  bindEvents() {
    // Auth events
    this.tabs.forEach((tab) => {
      tab.addEventListener('click', () => this.switchAuthTab(tab.dataset.tab));
    });
    this.authForm.addEventListener('submit', (e) => this.handleAuth(e));
    this.skipAuthBtn.addEventListener('click', () => this.skipAuth());
    this.logoutBtn.addEventListener('click', () => this.handleLogout());

    // Recording events
    this.startBtn.addEventListener('click', () => this.startRecording());
    this.pauseBtn.addEventListener('click', () => this.togglePause());
    this.stopBtn.addEventListener('click', () => this.stopRecording());
    this.downloadBtn.addEventListener('click', () => this.downloadRecording());
    this.newRecordingBtn.addEventListener('click', () => this.reset());
    this.retryBtn.addEventListener('click', () => this.reset());
    this.copyLinkBtn?.addEventListener('click', () => this.copyShareLink());

    // Listen for messages from service worker
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'SCREEN_SHARE_ENDED') {
        this.handleScreenShareEnded();
      }
    });
  }

  async checkState() {
    // Check if recording is in progress
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });

    if (response?.isRecording) {
      this.startTime = response.startTime;
      this.setState('recording');
      this.resumeTimerFromState();
      return;
    }

    // Check auth
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (apiClient.isAuthenticated()) {
      this.showIdleState();
    } else {
      this.setState('auth');
    }
  }

  resumeTimerFromState() {
    if (this.startTime) {
      this.timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
        this.elapsedSeconds = elapsed;
        this.updateTimerDisplay(elapsed);

        if (elapsed >= MAX_RECORDING_DURATION) {
          this.stopRecording();
        }
      }, 1000);
    }
  }

  handleScreenShareEnded() {
    if (this.state === RecordingState.RECORDING) {
      this.stopRecording();
    }
  }

  switchAuthTab(mode) {
    this.authMode = mode;
    this.tabs.forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === mode);
    });
    this.authSubmit.textContent = mode === 'login' ? 'Login' : 'Register';
    this.authError.classList.add('hidden');
  }

  async handleAuth(e) {
    e.preventDefault();
    const email = this.emailInput.value;
    const password = this.passwordInput.value;

    this.authSubmit.disabled = true;
    this.authSubmit.textContent = 'Loading...';
    this.authError.classList.add('hidden');

    try {
      if (this.authMode === 'login') {
        await apiClient.login(email, password);
      } else {
        await apiClient.register(email, password);
      }
      this.showIdleState();
    } catch (error) {
      this.authError.textContent = error.message;
      this.authError.classList.remove('hidden');
    } finally {
      this.authSubmit.disabled = false;
      this.authSubmit.textContent = this.authMode === 'login' ? 'Login' : 'Register';
    }
  }

  skipAuth() {
    this.isGuest = true;
    this.showIdleState();
  }

  async handleLogout() {
    await apiClient.logout();
    this.isGuest = false;
    this.setState('auth');
  }

  showIdleState() {
    const user = apiClient.getUser();
    if (user) {
      this.userInfo.textContent = `Logged in as ${user.email}`;
      this.logoutBtn.classList.remove('hidden');
    } else if (this.isGuest) {
      this.userInfo.textContent = 'Recording as guest (local only)';
      this.logoutBtn.classList.add('hidden');
    } else {
      this.userInfo.textContent = '';
      this.logoutBtn.classList.add('hidden');
    }
    this.setState('idle');
  }

  async startRecording() {
    try {
      // Disable button to prevent double-click
      this.startBtn.disabled = true;
      this.startBtn.textContent = 'Starting...';

      const response = await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        payload: {
          includeWebcam: this.webcamToggle.checked,
          includeMic: this.micToggle.checked,
        },
      });

      console.log('Start recording response:', response);

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to start recording');
      }

      // Only set state and start timer after successful start
      this.setState('recording');
      this.startTime = Date.now();
      this.startTimer();
    } catch (error) {
      console.error('Recording error:', error);
      this.showError(this.getErrorMessage(error));
    } finally {
      this.startBtn.disabled = false;
      this.startBtn.innerHTML = '<span class="btn-icon">●</span> Start Recording';
    }
  }

  async togglePause() {
    try {
      if (this.pauseBtn.textContent === 'Pause') {
        await chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' });
        this.pauseBtn.textContent = 'Resume';
        this.timerContainer.classList.add('paused');
        this.pauseTimer();
      } else {
        await chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' });
        this.pauseBtn.textContent = 'Pause';
        this.timerContainer.classList.remove('paused');
        this.resumeTimer();
      }
    } catch (error) {
      console.error('Pause/resume error:', error);
    }
  }

  async stopRecording() {
    if (this.state !== RecordingState.RECORDING) return;

    this.setState('processing');
    this.stopTimer();

    try {
      const response = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });

      if (!response.success) {
        throw new Error(response.error || 'Failed to stop recording');
      }

      const { blobData, blobSize, duration } = response.data;
      this.elapsedSeconds = duration;

      console.log('Recording stopped', { blobSize, duration });

      if (!blobData || blobSize === 0) {
        this.showError('Recording failed - no data captured. Try recording for at least 2 seconds.');
        return;
      }

      // Convert array back to blob
      this.recordingBlob = new Blob([new Uint8Array(blobData)], { type: 'video/webm' });

      // Upload if authenticated
      if (apiClient.isAuthenticated() && !this.isGuest) {
        await this.uploadRecording();
      } else {
        this.setState('complete');
      }
    } catch (error) {
      console.error('Stop recording error:', error);
      this.showError('Failed to process recording: ' + error.message);
    }
  }

  async uploadRecording() {
    this.setState('uploading');

    uploader.onProgress = (progress) => {
      this.uploadProgress.style.width = `${progress}%`;
      this.uploadStatus.textContent = `Uploading... ${Math.round(progress)}%`;
    };

    try {
      const result = await uploader.upload(
        this.recordingBlob,
        this.elapsedSeconds,
        `Recording ${new Date().toLocaleDateString()}`
      );

      this.shareUrl = result.shareUrl;
      this.shareLink.value = result.shareUrl;
      this.shareLinkContainer.classList.remove('hidden');
      this.setState('complete');
    } catch (error) {
      console.error('Upload error:', error);
      this.showError(`Upload failed: ${error.message}. You can still download locally.`);
      this.setState('complete');
    }
  }

  downloadRecording() {
    if (!this.recordingBlob || this.recordingBlob.size === 0) return;

    const url = URL.createObjectURL(this.recordingBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vibly-recording-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  copyShareLink() {
    if (this.shareUrl) {
      navigator.clipboard.writeText(this.shareUrl);
      this.copyLinkBtn.textContent = 'Copied!';
      setTimeout(() => {
        this.copyLinkBtn.textContent = 'Copy';
      }, 2000);
    }
  }

  reset() {
    this.recordingBlob = null;
    this.elapsedSeconds = 0;
    this.pausedTime = 0;
    this.shareUrl = null;
    this.timer.textContent = '00:00';
    this.timerContainer?.classList.remove('paused');
    this.pauseBtn.textContent = 'Pause';
    this.uploadProgress.style.width = '0%';
    this.shareLinkContainer.classList.add('hidden');
    this.showIdleState();
  }

  // Timer methods
  startTimer() {
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
  setState(stateName) {
    const stateMap = {
      auth: 'auth',
      idle: RecordingState.IDLE,
      recording: RecordingState.RECORDING,
      processing: RecordingState.PROCESSING,
      uploading: RecordingState.UPLOADING,
      complete: RecordingState.COMPLETE,
      error: RecordingState.ERROR,
    };

    this.state = stateMap[stateName] || stateName;

    // Hide all states
    this.authState.classList.add('hidden');
    this.idleState.classList.add('hidden');
    this.recordingState.classList.add('hidden');
    this.processingState.classList.add('hidden');
    this.uploadingState.classList.add('hidden');
    this.completeState.classList.add('hidden');
    this.errorState.classList.add('hidden');

    // Show current state
    switch (stateName) {
      case 'auth':
        this.authState.classList.remove('hidden');
        this.logoutBtn.classList.add('hidden');
        break;
      case 'idle':
        this.idleState.classList.remove('hidden');
        break;
      case 'recording':
        this.recordingState.classList.remove('hidden');
        break;
      case 'processing':
        this.processingState.classList.remove('hidden');
        break;
      case 'uploading':
        this.uploadingState.classList.remove('hidden');
        break;
      case 'complete':
        this.completeState.classList.remove('hidden');
        break;
      case 'error':
        this.errorState.classList.remove('hidden');
        break;
    }
  }

  showError(message) {
    this.errorMessage.textContent = message;
    this.setState('error');
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
      return "Your browser doesn't support recording.";
    }
    return error.message || 'Something went wrong. Please try again.';
  }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  new ViblyPopup();
});
