import { VIDEO_BITRATE } from './constants';

export class MediaHandler {
  mediaRecorder: MediaRecorder | null = null;
  recordedChunks: Blob[] = [];
  screenStream: MediaStream | null = null;
  audioStream: MediaStream | null = null;
  combinedStream: MediaStream | null = null;
  private _audioContext: AudioContext | null = null;

  async requestScreenCapture(): Promise<MediaStream> {
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      return this.screenStream;
    } catch (error: any) {
      if (error.name === 'NotAllowedError') {
        throw new Error('SCREEN_PERMISSION_DENIED');
      }
      throw error;
    }
  }

  async requestMicrophoneCapture(): Promise<MediaStream | null> {
    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      return this.audioStream;
    } catch {
      console.warn('Microphone access denied');
      return null;
    }
  }

  combineStreams(videoStream: MediaStream, micStream: MediaStream | null): MediaStream {
    const tracks: MediaStreamTrack[] = [];
    const videoTrack = videoStream.getVideoTracks()[0];
    if (videoTrack) tracks.push(videoTrack);

    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();

    const screenAudioTracks = videoStream.getAudioTracks();
    if (screenAudioTracks.length > 0) {
      const screenAudioSource = audioContext.createMediaStreamSource(new MediaStream([screenAudioTracks[0]]));
      screenAudioSource.connect(destination);
    }

    if (micStream) {
      const micAudioSource = audioContext.createMediaStreamSource(micStream);
      micAudioSource.connect(destination);
    }

    const audioTrack = destination.stream.getAudioTracks()[0];
    if (audioTrack) tracks.push(audioTrack);

    this.combinedStream = new MediaStream(tracks);
    this._audioContext = audioContext;
    return this.combinedStream;
  }


  startRecording(stream: MediaStream, onDataAvailable?: (data: Blob) => void): MediaRecorder {
    this.recordedChunks = [];
    const mimeType = this._getSupportedMimeType();
    const options: MediaRecorderOptions = { mimeType };
    if (VIDEO_BITRATE) options.videoBitsPerSecond = VIDEO_BITRATE;

    this.mediaRecorder = new MediaRecorder(stream, options);
    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data?.size > 0) {
        this.recordedChunks.push(event.data);
        onDataAvailable?.(event.data);
      }
    };
    this.mediaRecorder.onerror = (event: any) => console.error('MediaRecorder error:', event.error);
    this.mediaRecorder.start(1000);
    return this.mediaRecorder;
  }

  private _getSupportedMimeType(): string {
    const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return types.find((type) => MediaRecorder.isTypeSupported(type)) || 'video/webm';
  }

  pauseRecording(): void {
    if (this.mediaRecorder?.state === 'recording') this.mediaRecorder.pause();
  }

  resumeRecording(): void {
    if (this.mediaRecorder?.state === 'paused') this.mediaRecorder.resume();
  }

  async stopRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(null);
        return;
      }
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        resolve(blob);
      };
      if (this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.requestData();
        this.mediaRecorder.stop();
      } else {
        resolve(new Blob(this.recordedChunks, { type: 'video/webm' }));
      }
    });
  }

  cleanup(): void {
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.audioStream?.getTracks().forEach((t) => t.stop());
    this.combinedStream?.getTracks().forEach((t) => t.stop());
    this._audioContext?.close();
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.screenStream = null;
    this.audioStream = null;
    this.combinedStream = null;
  }

  getRecordingState(): RecordingState {
    return this.mediaRecorder?.state || 'inactive';
  }
}
