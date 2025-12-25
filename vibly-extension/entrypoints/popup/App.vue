<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { MediaHandler } from '@/utils/media-handler';
import { Compositor } from '@/utils/compositor';
import { apiClient } from '@/utils/api-client';
import { uploader } from '@/utils/uploader';
import { MAX_RECORDING_DURATION, RecordingState } from '@/utils/constants';

const mediaHandler = new MediaHandler();
const compositor = new Compositor();

const state = ref<string>('auth');
const recordingBlob = ref<Blob | null>(null);
const elapsedSeconds = ref(0);
const shareUrl = ref<string | null>(null);
const isGuest = ref(false);
const authMode = ref<'login' | 'register'>('login');
const email = ref('');
const password = ref('');
const authError = ref('');
const authLoading = ref(false);
const errorMessage = ref('');
const uploadProgress = ref(0);
const uploadStatus = ref('Uploading... 0%');
const webcamEnabled = ref(true);
const micEnabled = ref(true);

let timerInterval: number | null = null;
let startTime: number | null = null;
let pausedTime = 0;

const timerDisplay = computed(() => {
  const mins = Math.floor(elapsedSeconds.value / 60);
  const secs = elapsedSeconds.value % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
});

const isPaused = computed(() => mediaHandler.getRecordingState() === 'paused');
const userEmail = computed(() => apiClient.getUser()?.email || '');

onMounted(async () => {
  await new Promise((r) => setTimeout(r, 100));
  if (apiClient.isAuthenticated()) {
    state.value = RecordingState.IDLE;
  }
});

function switchAuthTab(mode: 'login' | 'register') {
  authMode.value = mode;
  authError.value = '';
}

async function handleAuth() {
  authLoading.value = true;
  authError.value = '';
  try {
    if (authMode.value === 'login') {
      await apiClient.login(email.value, password.value);
    } else {
      await apiClient.register(email.value, password.value);
    }
    state.value = RecordingState.IDLE;
  } catch (error: any) {
    authError.value = error.message;
  } finally {
    authLoading.value = false;
  }
}

function skipAuth() {
  isGuest.value = true;
  state.value = RecordingState.IDLE;
}

async function handleLogout() {
  await apiClient.logout();
  isGuest.value = false;
  state.value = 'auth';
}

async function startRecording() {
  try {
    const screenStream = await mediaHandler.requestScreenCapture();
    state.value = RecordingState.RECORDING;

    screenStream.getVideoTracks()[0].onended = () => {
      if (state.value === RecordingState.RECORDING) stopRecording();
    };

    let webcamStream: MediaStream | null = null;
    if (webcamEnabled.value) {
      webcamStream = await compositor.requestWebcamCapture();
    }

    let micStream: MediaStream | null = null;
    if (micEnabled.value) {
      micStream = await mediaHandler.requestMicrophoneCapture();
    }

    let finalStream: MediaStream;
    if (webcamStream) {
      await compositor.initialize(screenStream, webcamStream);
      compositor.start();
      const compositedStream = compositor.getOutputStream();
      finalStream = mediaHandler.combineStreams(compositedStream, micStream);
    } else {
      finalStream = mediaHandler.combineStreams(screenStream, micStream);
    }

    mediaHandler.startRecording(finalStream);
    startTimer();
  } catch (error: any) {
    showError(getErrorMessage(error));
  }
}

function togglePause() {
  if (mediaHandler.getRecordingState() === 'recording') {
    mediaHandler.pauseRecording();
    pauseTimer();
  } else {
    mediaHandler.resumeRecording();
    resumeTimer();
  }
}

async function stopRecording() {
  if (state.value !== RecordingState.RECORDING) return;
  state.value = RecordingState.PROCESSING;
  stopTimer();

  try {
    if (mediaHandler.mediaRecorder?.state === 'recording') {
      mediaHandler.mediaRecorder.requestData();
    }
    await new Promise((r) => setTimeout(r, 300));

    compositor.stop();
    recordingBlob.value = await mediaHandler.stopRecording();
    mediaHandler.cleanup();
    compositor.cleanup();

    if (!recordingBlob.value || recordingBlob.value.size === 0) {
      showError('Recording failed - no data captured. Try recording for at least 2 seconds.');
      return;
    }

    if (apiClient.isAuthenticated() && !isGuest.value) {
      await uploadRecording();
    } else {
      state.value = RecordingState.COMPLETE;
    }
  } catch (error: any) {
    showError('Failed to process recording: ' + error.message);
  }
}

async function uploadRecording() {
  state.value = RecordingState.UPLOADING;
  uploader.onProgress = (progress) => {
    uploadProgress.value = progress;
    uploadStatus.value = `Uploading... ${Math.round(progress)}%`;
  };

  try {
    const result = await uploader.upload(
      recordingBlob.value!,
      elapsedSeconds.value,
      `Recording ${new Date().toLocaleDateString()}`
    );
    shareUrl.value = result.shareUrl;
    state.value = RecordingState.COMPLETE;
  } catch (error: any) {
    showError(`Upload failed: ${error.message}. You can still download locally.`);
    state.value = RecordingState.COMPLETE;
  }
}

function downloadRecording() {
  if (!recordingBlob.value || recordingBlob.value.size === 0) return;
  const url = URL.createObjectURL(recordingBlob.value);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vibly-recording-${Date.now()}.webm`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function copyShareLink() {
  if (shareUrl.value) {
    navigator.clipboard.writeText(shareUrl.value);
  }
}

function reset() {
  recordingBlob.value = null;
  elapsedSeconds.value = 0;
  pausedTime = 0;
  shareUrl.value = null;
  uploadProgress.value = 0;
  state.value = RecordingState.IDLE;
}

function startTimer() {
  startTime = Date.now();
  elapsedSeconds.value = 0;
  timerInterval = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime!) / 1000) + pausedTime;
    elapsedSeconds.value = elapsed;
    if (elapsed >= MAX_RECORDING_DURATION) stopRecording();
  }, 1000);
}

function pauseTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    pausedTime = elapsedSeconds.value;
  }
}

function resumeTimer() {
  startTime = Date.now();
  timerInterval = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime!) / 1000) + pausedTime;
    elapsedSeconds.value = elapsed;
    if (elapsed >= MAX_RECORDING_DURATION) stopRecording();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function showError(message: string) {
  errorMessage.value = message;
  state.value = RecordingState.ERROR;
  mediaHandler.cleanup();
  compositor.cleanup();
  stopTimer();
}

function getErrorMessage(error: any): string {
  if (error.message === 'SCREEN_PERMISSION_DENIED') return 'Screen access denied. Click to try again.';
  if (error.name === 'NotAllowedError') return 'Permission denied. Please allow access and try again.';
  if (error.name === 'NotFoundError') return 'No screen or camera found.';
  if (error.name === 'NotSupportedError') return "Your browser doesn't support recording.";
  return error.message || 'Something went wrong. Please try again.';
}
</script>

<template>
  <div class="container">
    <header class="header">
      <h1 class="logo">Vibly</h1>
      <button v-if="state !== 'auth' && !isGuest" class="btn-icon-only" title="Logout" @click="handleLogout">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
          <polyline points="16 17 21 12 16 7"></polyline>
          <line x1="21" y1="12" x2="9" y2="12"></line>
        </svg>
      </button>
    </header>

    <!-- Auth State -->
    <div v-if="state === 'auth'" class="state">
      <div class="auth-tabs">
        <button :class="['tab', { active: authMode === 'login' }]" @click="switchAuthTab('login')">Login</button>
        <button :class="['tab', { active: authMode === 'register' }]" @click="switchAuthTab('register')">Register</button>
      </div>
      <form class="auth-form" @submit.prevent="handleAuth">
        <input v-model="email" type="email" placeholder="Email" required />
        <input v-model="password" type="password" placeholder="Password" required />
        <button type="submit" class="btn btn-primary" :disabled="authLoading">
          {{ authLoading ? 'Loading...' : authMode === 'login' ? 'Login' : 'Register' }}
        </button>
      </form>
      <p v-if="authError" class="error-text">{{ authError }}</p>
      <div class="divider">or</div>
      <button class="btn btn-secondary" @click="skipAuth">Record without account</button>
    </div>

    <!-- Idle State -->
    <div v-if="state === 'idle'" class="state">
      <div class="user-info">{{ isGuest ? 'Recording as guest (local only)' : `Logged in as ${userEmail}` }}</div>
      <div class="options">
        <label class="option"><input v-model="webcamEnabled" type="checkbox" /><span>Include webcam</span></label>
        <label class="option"><input v-model="micEnabled" type="checkbox" /><span>Include microphone</span></label>
      </div>
      <button class="btn btn-primary" @click="startRecording"><span class="btn-icon">●</span> Start Recording</button>
    </div>

    <!-- Recording State -->
    <div v-if="state === 'recording'" class="state">
      <div class="recording-notice">⚠️ Keep this popup open while recording</div>
      <div :class="['timer-container', { paused: isPaused }]">
        <span class="recording-dot"></span>
        <span class="timer">{{ timerDisplay }}</span>
        <span class="time-limit">/ 7:00</span>
      </div>
      <div class="controls">
        <button class="btn btn-secondary" @click="togglePause">{{ isPaused ? 'Resume' : 'Pause' }}</button>
        <button class="btn btn-danger" @click="stopRecording">Stop</button>
      </div>
    </div>

    <!-- Processing State -->
    <div v-if="state === 'processing'" class="state">
      <div class="processing"><div class="spinner"></div><p>Preparing video...</p></div>
    </div>

    <!-- Uploading State -->
    <div v-if="state === 'uploading'" class="state">
      <div class="uploading">
        <div class="progress-bar"><div class="progress-fill" :style="{ width: uploadProgress + '%' }"></div></div>
        <p>{{ uploadStatus }}</p>
      </div>
    </div>

    <!-- Complete State -->
    <div v-if="state === 'complete'" class="state">
      <div class="complete">
        <p class="success-text">Recording complete!</p>
        <div v-if="shareUrl" class="share-link-container">
          <input type="text" class="share-link" :value="shareUrl" readonly />
          <button class="btn btn-small" @click="copyShareLink">Copy</button>
        </div>
        <button class="btn btn-primary" @click="downloadRecording">Download Video</button>
        <button class="btn btn-secondary" @click="reset">New Recording</button>
      </div>
    </div>

    <!-- Error State -->
    <div v-if="state === 'error'" class="state">
      <div class="error">
        <p class="error-text">{{ errorMessage }}</p>
        <button class="btn btn-secondary" @click="reset">Try Again</button>
      </div>
    </div>

    <footer class="footer"><span class="version">v2.0.0</span></footer>
  </div>
</template>

<style scoped>
* { margin: 0; padding: 0; box-sizing: border-box; }
.container { padding: 20px; display: flex; flex-direction: column; gap: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #eee; width: 320px; min-height: 200px; }
.header { display: flex; justify-content: space-between; align-items: center; }
.logo { font-size: 24px; font-weight: 700; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
.btn-icon-only { background: transparent; border: none; color: #888; cursor: pointer; padding: 4px; }
.btn-icon-only:hover { color: #eee; }
.state { display: flex; flex-direction: column; gap: 16px; }
.auth-tabs { display: flex; gap: 8px; }
.tab { flex: 1; padding: 8px; background: #2d2d44; border: none; color: #888; cursor: pointer; border-radius: 6px; font-size: 14px; }
.tab.active { background: #667eea; color: white; }
.auth-form { display: flex; flex-direction: column; gap: 12px; }
.auth-form input { padding: 12px; border: 1px solid #3d3d5c; border-radius: 8px; background: #2d2d44; color: #eee; font-size: 14px; }
.auth-form input:focus { outline: none; border-color: #667eea; }
.divider { text-align: center; color: #666; font-size: 12px; }
.user-info { font-size: 12px; color: #888; text-align: center; }
.options { display: flex; flex-direction: column; gap: 8px; }
.option { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; color: #aaa; }
.option input[type="checkbox"] { width: 16px; height: 16px; accent-color: #667eea; }
.btn { padding: 12px 24px; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; gap: 8px; }
.btn-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
.btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4); }
.btn-secondary { background: #2d2d44; color: #eee; }
.btn-secondary:hover { background: #3d3d5c; }
.btn-danger { background: #e74c3c; color: white; }
.btn-danger:hover { background: #c0392b; }
.btn-icon { font-size: 10px; }
.btn-small { padding: 8px 12px; font-size: 12px; }
.recording-notice { background: rgba(231, 76, 60, 0.1); border: 1px solid rgba(231, 76, 60, 0.3); border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #e74c3c; text-align: center; }
.timer-container { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 16px; background: #2d2d44; border-radius: 8px; }
.recording-dot { width: 12px; height: 12px; background: #e74c3c; border-radius: 50%; animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
.timer { font-size: 32px; font-weight: 700; font-variant-numeric: tabular-nums; }
.time-limit { font-size: 14px; color: #888; }
.controls { display: flex; gap: 12px; }
.controls .btn { flex: 1; }
.share-link-container { display: flex; gap: 8px; }
.share-link { flex: 1; padding: 8px; border: 1px solid #3d3d5c; border-radius: 6px; background: #2d2d44; color: #eee; font-size: 12px; }
.uploading { display: flex; flex-direction: column; gap: 12px; padding: 20px; }
.progress-bar { height: 8px; background: #2d2d44; border-radius: 4px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); transition: width 0.3s ease; }
.processing { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 20px; }
.spinner { width: 32px; height: 32px; border: 3px solid #2d2d44; border-top-color: #667eea; border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.complete { display: flex; flex-direction: column; gap: 12px; text-align: center; }
.success-text { color: #2ecc71; font-weight: 600; }
.error { display: flex; flex-direction: column; gap: 12px; text-align: center; }
.error-text { color: #e74c3c; font-size: 14px; }
.footer { text-align: center; padding-top: 8px; border-top: 1px solid #2d2d44; }
.version { font-size: 12px; color: #666; }
.paused .recording-dot { animation: none; opacity: 0.5; }
.paused .timer { opacity: 0.7; }
</style>
