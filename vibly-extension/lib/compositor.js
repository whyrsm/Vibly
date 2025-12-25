// Canvas-based compositor for screen + webcam overlay
import { VIDEO_FRAMERATE, WEBCAM_SIZE_RATIO } from '../config/constants.js';

export class Compositor {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.screenVideo = null;
    this.webcamVideo = null;
    this.webcamStream = null;
    this.animationId = null;
    this.isRunning = false;
    
    // Webcam position (default: bottom-right)
    this.webcamPosition = { x: null, y: null };
  }

  async requestWebcamCapture() {
    try {
      this.webcamStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false // Audio handled separately
      });
      return this.webcamStream;
    } catch (error) {
      console.warn('Webcam access denied, continuing without webcam overlay');
      return null;
    }
  }

  async initialize(screenStream, webcamStream = null) {
    // Create canvas
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    
    // Get screen dimensions
    const videoTrack = screenStream.getVideoTracks()[0];
    const settings = videoTrack.getSettings();
    this.canvas.width = settings.width || 1920;
    this.canvas.height = settings.height || 1080;

    // Setup screen video element
    this.screenVideo = document.createElement('video');
    this.screenVideo.srcObject = screenStream;
    this.screenVideo.muted = true;
    await this.screenVideo.play();
    
    // Setup webcam video element if available
    if (webcamStream) {
      this.webcamStream = webcamStream;
      this.webcamVideo = document.createElement('video');
      this.webcamVideo.srcObject = webcamStream;
      this.webcamVideo.muted = true;
      await this.webcamVideo.play();
    }
    
    return this.canvas;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._composite();
  }

  _composite() {
    if (!this.isRunning) return;
    
    // Draw screen frame
    this.ctx.drawImage(
      this.screenVideo, 
      0, 0, 
      this.canvas.width, 
      this.canvas.height
    );
    
    // Draw webcam overlay if available
    if (this.webcamVideo && this.webcamStream?.active) {
      this._drawWebcamOverlay();
    }
    
    this.animationId = requestAnimationFrame(() => this._composite());
  }

  _drawWebcamOverlay() {
    const webcamWidth = this.canvas.width * WEBCAM_SIZE_RATIO;
    const webcamHeight = webcamWidth * 0.75; // 4:3 aspect ratio
    
    // Default position: bottom-right with padding
    const padding = 20;
    const x = this.webcamPosition.x ?? (this.canvas.width - webcamWidth - padding);
    const y = this.webcamPosition.y ?? (this.canvas.height - webcamHeight - padding);
    
    // Draw circular clip for webcam
    this.ctx.save();
    
    // Create rounded rectangle clip
    const radius = 12;
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, webcamWidth, webcamHeight, radius);
    this.ctx.clip();
    
    // Draw webcam video
    this.ctx.drawImage(this.webcamVideo, x, y, webcamWidth, webcamHeight);
    
    this.ctx.restore();
    
    // Draw border
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, webcamWidth, webcamHeight, radius);
    this.ctx.stroke();
  }

  setWebcamPosition(x, y) {
    this.webcamPosition = { x, y };
  }

  getOutputStream() {
    return this.canvas.captureStream(VIDEO_FRAMERATE);
  }

  stop() {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  cleanup() {
    this.stop();
    
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach(track => track.stop());
    }
    
    if (this.screenVideo) {
      this.screenVideo.srcObject = null;
    }
    if (this.webcamVideo) {
      this.webcamVideo.srcObject = null;
    }
    
    this.canvas = null;
    this.ctx = null;
    this.screenVideo = null;
    this.webcamVideo = null;
    this.webcamStream = null;
  }

  hasWebcam() {
    return this.webcamStream !== null && this.webcamStream.active;
  }
}
