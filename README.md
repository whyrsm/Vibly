# Vibly

Lightweight screen recording Chrome extension with webcam overlay. Record and share instantly.

## Features

- **Screen + Webcam Recording** - Capture your screen with a webcam overlay in the corner
- **Cloud Upload** - Automatically upload and get shareable links
- **No Download Required** - Share recordings via instant cloud-hosted links
- **Simple & Fast** - No editing features, optimized for quick recordings
- **7-Minute Free Tier** - Perfect for quick demos and walkthroughs

## Project Structure

```
├── vibly-extension/     # Chrome Extension (Manifest V3)
│   ├── popup/           # Extension popup UI
│   ├── lib/             # Recording, upload & API logic
│   ├── background/      # Service worker
│   └── config/          # Constants & settings
│
├── vibly-backend/       # NestJS API
│   ├── src/auth/        # JWT authentication
│   ├── src/recordings/  # Upload & share management
│   ├── src/r2/          # Cloudflare R2 integration
│   └── prisma/          # Database schema
│
└── PROJECT.md           # Detailed technical specification
```

## Quick Start

### 1. Backend Setup

```bash
cd vibly-backend

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your database and R2 credentials

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# Start the server
npm run start:dev
```

### 2. Chrome Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" and select the `vibly-extension` folder
4. Click the Vibly icon in your toolbar

### Current Status

- [x] Screen capture with webcam overlay
- [x] Microphone + system audio recording
- [x] Pause/resume functionality
- [x] Local download (WebM format)
- [x] Backend API (auth, upload, share)
- [x] Cloud upload with progress
- [x] Shareable links
- [ ] Public video player page

## Tech Stack

**Extension:** Vanilla JS, Canvas API, MediaRecorder API, Manifest V3

**Backend:** NestJS, PostgreSQL, Prisma, Cloudflare R2, JWT Auth

## API Endpoints

- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login
- `POST /api/auth/refresh` - Refresh token
- `POST /api/recordings/init` - Initialize upload
- `POST /api/recordings/:id/complete` - Complete upload
- `GET /api/recordings` - List recordings
- `DELETE /api/recordings/:id` - Delete recording
- `GET /api/watch/:shareToken` - Get video (public)

## License

MIT