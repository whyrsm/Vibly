// API Configuration
export const API_URL = 'http://localhost:3000';

// Recording limits
export const MAX_RECORDING_DURATION = 420; // 7 minutes in seconds
export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

// Upload configuration
export const PART_SIZE = 5 * 1024 * 1024; // 5MB (S3 minimum)

// Video settings
export const VIDEO_BITRATE = 2500000; // 2.5 Mbps
export const VIDEO_FRAMERATE = 30;
export const WEBCAM_SIZE_RATIO = 0.2; // 20% of screen width

// Recording states
export enum RecordingState {
  IDLE = 'idle',
  RECORDING = 'recording',
  PAUSED = 'paused',
  PROCESSING = 'processing',
  UPLOADING = 'uploading',
  COMPLETE = 'complete',
  ERROR = 'error',
}
