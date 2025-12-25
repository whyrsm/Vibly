// MediaRecorder wrapper for screen + audio capture
import { VIDEO_BITRATE } from '../config/constants.js';

export class MediaHandler {
  constructor() {
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.screenStream = null;
    this.audioStream = null;
    this.combinedStream = null;
  }

  async requestScreenCapture() {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor'
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      return this.screenStream;
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        throw new Error('SCREEN_PERMISSION_DENIED');
      }
      throw error;
    }
  }

  async requestMicrophoneCapture() {
    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      return this.audioStream;
    } catch (error) {
      console.warn('Microphone access denied, continuing without mic audio');
      return null;
    }
  }

  combineStreams(videoStream, micStream) {
    const tracks = [];
    
    // Add video track from screen/compositor
    const videoTrack = videoStream.getVideoTracks()[0];
    if (videoTrack) tracks.push(videoTrack);
    
    // Combine audio tracks if available
    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();
    
    // Add system audio from screen capture
    const screenAudioTracks = videoStream.getAudioTracks();
    if (screenAudioTracks.length > 0) {
      const screenAudioSource = audioContext.createMediaStreamSource(
        new MediaStream([screenAudioTracks[0]])
      );
      screenAudioSource.connect(destination);
    }
    
    // Add microphone audio
    if (micStream) {
      const micAudioSource = audioContext.createMediaStreamSource(micStream);
      micAudioSource.connect(destination);
    }
    
    // Add combined audio track
    const audioTrack = destination.stream.getAudioTracks()[0];
    if (audioTrack) tracks.push(audioTrack);
    
    this.combinedStream = new MediaStream(tracks);
    this._audioContext = audioContext;
    
    return this.combinedStream;
  }

  startRecording(stream, onDataAvailable) {
    this.recordedChunks = [];
    
    // Determine best codec
    const mimeType = this._getSupportedMimeType();
    console.log('Using mimeType:', mimeType);
    
    const options = { mimeType };
    if (VIDEO_BITRATE) {
      options.videoBitsPerSecond = VIDEO_BITRATE;
    }
    
    this.mediaRecorder = new MediaRecorder(stream, options);

    this.mediaRecorder.ondataavailable = (event) => {
      console.log('Data available:', event.data.size, 'bytes');
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
        if (onDataAvailable) onDataAvailable(event.data);
      }
    };

    this.mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event.error);
    };

    // Use timeslice to get data periodically
    this.mediaRecorder.start(1000);
    console.log('MediaRecorder started, state:', this.mediaRecorder.state);
    
    return this.mediaRecorder;
  }

  _getSupportedMimeType() {
    const types = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return 'video/webm';
  }

  pauseRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
    }
  }

  resumeRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
    }
  }

  async stopRecording() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        console.warn('No mediaRecorder to stop');
        resolve(null);
        return;
      }

      console.log('Stopping recorder, current state:', this.mediaRecorder.state);
      console.log('Chunks collected so far:', this.recordedChunks.length);

      this.mediaRecorder.onstop = () => {
        console.log('MediaRecorder stopped, total chunks:', this.recordedChunks.length);
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        console.log('Created blob, size:', blob.size);
        resolve(blob);
      };

      if (this.mediaRecorder.state !== 'inactive') {
        // Request any pending data
        this.mediaRecorder.requestData();
        this.mediaRecorder.stop();
      } else {
        console.log('Recorder already inactive, creating blob from existing chunks');
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        resolve(blob);
      }
    });
  }

  cleanup() {
    // Stop all tracks
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(track => track.stop());
    }
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
    }
    if (this.combinedStream) {
      this.combinedStream.getTracks().forEach(track => track.stop());
    }
    
    // Close audio context
    if (this._audioContext) {
      this._audioContext.close();
    }

    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.screenStream = null;
    this.audioStream = null;
    this.combinedStream = null;
  }

  getRecordingState() {
    if (!this.mediaRecorder) return 'inactive';
    return this.mediaRecorder.state;
  }
}
