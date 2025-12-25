import { VIDEO_FRAMERATE, WEBCAM_SIZE_RATIO } from './constants';

export class Compositor {
  canvas: HTMLCanvasElement | null = null;
  ctx: CanvasRenderingContext2D | null = null;
  screenVideo: HTMLVideoElement | null = null;
  webcamVideo: HTMLVideoElement | null = null;
  webcamStream: MediaStream | null = null;
  animationId: number | null = null;
  isRunning = false;
  webcamPosition = { x: null as number | null, y: null as number | null };

  async requestWebcamCapture(): Promise<MediaStream | null> {
    try {
      this.webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
      return this.webcamStream;
    } catch {
      console.warn('Webcam access denied');
      return null;
    }
  }

  async initialize(screenStream: MediaStream, webcamStream: MediaStream | null = null): Promise<HTMLCanvasElement> {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');

    const videoTrack = screenStream.getVideoTracks()[0];
    const settings = videoTrack.getSettings();
    this.canvas.width = settings.width || 1920;
    this.canvas.height = settings.height || 1080;

    this.screenVideo = document.createElement('video');
    this.screenVideo.srcObject = screenStream;
    this.screenVideo.muted = true;
    await this.screenVideo.play();

    if (webcamStream) {
      this.webcamStream = webcamStream;
      this.webcamVideo = document.createElement('video');
      this.webcamVideo.srcObject = webcamStream;
      this.webcamVideo.muted = true;
      await this.webcamVideo.play();
    }
    return this.canvas;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this._composite();
  }


  private _composite(): void {
    if (!this.isRunning || !this.ctx || !this.canvas || !this.screenVideo) return;
    this.ctx.drawImage(this.screenVideo, 0, 0, this.canvas.width, this.canvas.height);
    if (this.webcamVideo && this.webcamStream?.active) this._drawWebcamOverlay();
    this.animationId = requestAnimationFrame(() => this._composite());
  }

  private _drawWebcamOverlay(): void {
    if (!this.ctx || !this.canvas || !this.webcamVideo) return;
    const webcamWidth = this.canvas.width * WEBCAM_SIZE_RATIO;
    const webcamHeight = webcamWidth * 0.75;
    const padding = 20;
    const x = this.webcamPosition.x ?? this.canvas.width - webcamWidth - padding;
    const y = this.webcamPosition.y ?? this.canvas.height - webcamHeight - padding;
    const radius = 12;

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, webcamWidth, webcamHeight, radius);
    this.ctx.clip();
    this.ctx.drawImage(this.webcamVideo, x, y, webcamWidth, webcamHeight);
    this.ctx.restore();

    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, webcamWidth, webcamHeight, radius);
    this.ctx.stroke();
  }

  setWebcamPosition(x: number, y: number): void {
    this.webcamPosition = { x, y };
  }

  getOutputStream(): MediaStream {
    return this.canvas!.captureStream(VIDEO_FRAMERATE);
  }

  stop(): void {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  cleanup(): void {
    this.stop();
    this.webcamStream?.getTracks().forEach((t) => t.stop());
    if (this.screenVideo) this.screenVideo.srcObject = null;
    if (this.webcamVideo) this.webcamVideo.srcObject = null;
    this.canvas = null;
    this.ctx = null;
    this.screenVideo = null;
    this.webcamVideo = null;
    this.webcamStream = null;
  }

  hasWebcam(): boolean {
    return this.webcamStream !== null && this.webcamStream.active;
  }
}
