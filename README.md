# Vibly

Lightweight screen recording Chrome extension with webcam overlay. Record and share instantly.

## Features

- **Screen + Webcam Recording** - Capture your screen with a webcam overlay in the corner
- **No Download Required** - Share recordings via instant cloud-hosted links
- **Simple & Fast** - No editing features, optimized for quick recordings
- **7-Minute Free Tier** - Perfect for quick demos and walkthroughs

## Project Structure

```
├── vibly-extension/     # Chrome Extension (Manifest V3)
│   ├── popup/           # Extension popup UI
│   ├── lib/             # Recording & compositing logic
│   ├── background/      # Service worker
│   └── config/          # Constants & settings
│
├── vibly-backend/       # NestJS API (coming soon)
│   ├── src/auth/        # JWT authentication
│   ├── src/recordings/  # Upload & share management
│   └── src/r2/          # Cloudflare R2 integration
│
└── PROJECT.md           # Detailed technical specification
```

## Quick Start

### Chrome Extension (Local Development)

1. Clone the repository
2. Open Chrome and go to `chrome://extensions`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked" and select the `vibly-extension` folder
5. Click the Vibly icon in your toolbar to start recording

### Current Status

- [x] Screen capture with webcam overlay
- [x] Microphone + system audio recording
- [x] Pause/resume functionality
- [x] Local download (WebM format)
- [ ] Backend API
- [ ] Cloud upload & sharing
- [ ] Public video player

## Tech Stack

**Extension:** Vanilla JS, Canvas API, MediaRecorder API, Manifest V3

**Backend:** NestJS, PostgreSQL, Cloudflare R2, JWT Auth

## License

MIT