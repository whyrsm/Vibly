# Vibly - Screen Recording Chrome Extension

## Product Overview

Vibly is a lightweight screen recording Chrome extension that enables users to record their screen with webcam overlay and instantly share via cloud-hosted links. Built for makers, developers, and remote professionals who need quick, no-frills screen recording.

**Key Differentiators:**
- Instant shareable links (no download required)
- Screen + webcam overlay
- No editing features (intentionally lean)
- Optimized for speed over feature bloat

**Target Users:**
- Indie developers doing product demos
- Remote consultants doing client walkthroughs
- Technical educators creating quick tutorials

## Technical Architecture

### Tech Stack

**Frontend (Chrome Extension):**
- WXT (Web Extension Tools) - Modern extension framework
- Vue 3 with Composition API
- TypeScript
- Canvas API for webcam overlay compositing
- MediaRecorder API for video capture

**Backend:**
- NestJS (TypeScript)
- PostgreSQL (metadata storage)
- Prisma ORM
- Cloudflare R2 (video file storage)
- JWT authentication (email/password)

**Infrastructure:**
- Railway/Fly.io for backend hosting
- Cloudflare R2 for object storage ($0.015/GB, zero egress)
- Cloudflare CDN for video delivery

### System Components
```
┌─────────────────┐
│ Chrome Extension│
│  (WXT + Vue 3)  │
│  - Screen Cap   │
│  - Webcam       │
│  - Compositor   │
└────────┬────────┘
         │ Upload (S3 multipart)
         ▼
┌─────────────────┐      ┌──────────────┐
│   NestJS API    │─────▶│ Cloudflare R2│
│  - Auth         │      │ Video Storage│
│  - Upload Mgmt  │      └──────────────┘
│  - Link Gen     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   PostgreSQL    │
│  - Users        │
│  - Recordings   │
│  - UploadSessions│
└─────────────────┘
```

### Decisions (Locked for MVP)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Authentication | Email/password | Simplest to implement; add Google OAuth in Phase 2 |
| Free tier duration | 7 minutes max | Configurable per tier |
| Free tier retention | 30 days | Balances storage cost vs user value |
| Video quality | Fixed 1080p @ 2.5 Mbps | Simplicity; no transcoding needed |
| Privacy default | Public (unlisted) | Simpler UX; link required to view |
| Upload strategy | S3 multipart upload | R2 is S3-compatible; native chunk combining |

### Core Features (MVP)

**Recording:**
- Screen capture (full screen, window, or tab)
- Webcam overlay (bottom-right corner, rounded corners)
- Real-time recording status indicator
- Stop/pause controls
- Microphone + system audio mixing

**Upload & Sharing:**
- S3 multipart upload (5MB parts) for reliable large file uploads
- Generate shareable link immediately after upload
- Public video player page at vibly.com/v/:shareToken
- Copy-to-clipboard for quick sharing

**Video Format:**
- WebM format (native Chrome support, no transcoding needed)
- Video codec: VP9 (preferred) or VP8 (fallback)
- Audio codec: Opus
- Target bitrate: 2.5 Mbps (balance quality/file size)

### Data Models

**User:**
```typescript
{
  id: uuid
  email: string
  passwordHash: string
  subscriptionTier: 'free' | 'pro'
  createdAt: timestamp
  updatedAt: timestamp
}
```

**Recording:**
```typescript
{
  id: uuid
  userId: uuid (foreign key)
  title: string
  duration: integer (seconds)
  filePath: string (R2 object key)
  fileSize: bigint (bytes)
  shareToken: string (unique, indexed)
  isPublic: boolean
  viewCount: integer
  createdAt: timestamp
  expiresAt: timestamp (optional, for free tier)
}
```

**UploadSession:**
```typescript
{
  id: uuid
  recordingId: uuid
  userId: uuid
  uploadId: string (S3 multipart upload ID)
  status: 'uploading' | 'completed' | 'failed' | 'expired'
  partsUploaded: integer
  createdAt: timestamp
  expiresAt: timestamp (15 minutes from creation)
}
```

**RefreshToken:**
```typescript
{
  id: uuid
  userId: uuid
  token: string (unique)
  expiresAt: timestamp
  createdAt: timestamp
}
```

### API Endpoints

**Authentication:**
```
POST /api/auth/register
  → Body: { email, password }
  → Returns: { accessToken, refreshToken, user }

POST /api/auth/login
  → Body: { email, password }
  → Returns: { accessToken, refreshToken, user }

POST /api/auth/refresh
  → Body: { refreshToken }
  → Returns: { accessToken, refreshToken, user }

POST /api/auth/logout
  → Invalidates refresh token
```

**Recording Management:**
```
POST /api/recordings/init
  → Body: { estimatedSize, partCount }
  → Returns: { recordingId, uploadUrls[] }

POST /api/recordings/:id/complete
  → Body: { parts: [{ partNumber, etag }], duration, title? }
  → Returns: { shareUrl }

GET /api/recordings (authenticated)
  → Returns: User's recording list

DELETE /api/recordings/:id (authenticated)
  → Soft delete (marks expired, cleanup job handles R2)
```

**Public Access:**
```
GET /api/watch/:shareToken
  → Returns: Recording metadata + signed R2 URL (1-hour expiry)
```

### Chrome Extension Architecture

**File Structure:**
```
vibly-extension/
├── wxt.config.ts              # WXT configuration & manifest
├── package.json
├── tsconfig.json
├── entrypoints/
│   ├── popup/                 # Extension popup UI
│   │   ├── main.ts            # Vue app entry
│   │   ├── App.vue            # Main component
│   │   └── index.html
│   └── background.ts          # Service worker
├── utils/
│   ├── constants.ts           # API URLs, settings
│   ├── media-handler.ts       # MediaRecorder wrapper
│   ├── compositor.ts          # Canvas-based screen+webcam merge
│   ├── uploader.ts            # S3 multipart upload logic
│   └── api-client.ts          # Backend API calls + auth
├── components/                # Reusable Vue components
├── assets/                    # Static assets
└── public/
    └── icon.svg               # Extension icon
```

### Extension Error States & UX

**Permission Errors:**
| Error | User Message | Action |
|-------|--------------|--------|
| Screen permission denied | "Screen access denied. Click to try again." | Re-prompt permission |
| Webcam permission denied | Continue without webcam | Recording proceeds |
| No audio device | Continue without audio | Recording proceeds |

**Recording Errors:**
| Error | User Message | Action |
|-------|--------------|--------|
| MediaRecorder not supported | "Your browser doesn't support recording." | Show Chrome version requirement |
| Recording failed to start | "Couldn't start recording. Please try again." | Reset state, allow retry |
| Tab closed during recording | Recording stops automatically | Save partial recording if possible |

**Upload Errors:**
| Error | User Message | Action |
|-------|--------------|--------|
| Network offline | Upload fails | Offer local download as fallback |
| Upload timeout | "Upload failed" | Auto-retry with backoff |
| Server error (5xx) | "Upload failed" | Auto-retry 3x, then show manual retry |
| Auth expired | Token refresh attempted | If fails, redirect to login |

**Progress States:**
- Recording: Show duration timer + red dot indicator
- Processing: "Preparing video..." (brief, during blob finalization)
- Uploading: Progress bar with percentage + "Uploading... X%" 
- Complete: Share URL visible with copy button

### Key Implementation Details

**Webcam Overlay Compositing (compositor.ts):**
```typescript
export class Compositor {
  canvas: HTMLCanvasElement | null = null;
  ctx: CanvasRenderingContext2D | null = null;
  screenVideo: HTMLVideoElement | null = null;
  webcamVideo: HTMLVideoElement | null = null;

  async initialize(screenStream: MediaStream, webcamStream: MediaStream | null): Promise<HTMLCanvasElement> {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');

    const videoTrack = screenStream.getVideoTracks()[0];
    const settings = videoTrack.getSettings();
    this.canvas.width = settings.width || 1920;
    this.canvas.height = settings.height || 1080;

    // Set up video elements for screen and webcam
    this.screenVideo = document.createElement('video');
    this.screenVideo.srcObject = screenStream;
    await this.screenVideo.play();

    if (webcamStream) {
      this.webcamVideo = document.createElement('video');
      this.webcamVideo.srcObject = webcamStream;
      await this.webcamVideo.play();
    }
    return this.canvas;
  }

  private _composite(): void {
    if (!this.isRunning || !this.ctx || !this.canvas || !this.screenVideo) return;
    
    // Draw screen frame
    this.ctx.drawImage(this.screenVideo, 0, 0, this.canvas.width, this.canvas.height);
    
    // Draw webcam overlay (bottom-right, 20% width, rounded corners)
    if (this.webcamVideo) this._drawWebcamOverlay();
    
    requestAnimationFrame(() => this._composite());
  }

  getOutputStream(): MediaStream {
    return this.canvas!.captureStream(30); // 30 fps
  }
}
```

**Audio Mixing (media-handler.ts):**
```typescript
combineStreams(videoStream: MediaStream, micStream: MediaStream | null): MediaStream {
  const tracks: MediaStreamTrack[] = [];
  const videoTrack = videoStream.getVideoTracks()[0];
  if (videoTrack) tracks.push(videoTrack);

  // Mix system audio + microphone using AudioContext
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

  return new MediaStream(tracks);
}
```

**S3 Multipart Upload Strategy (uploader.ts):**
```typescript
const PART_SIZE = 5 * 1024 * 1024; // 5MB minimum for S3

async upload(blob: Blob, duration: number, title: string): Promise<{ shareUrl: string }> {
  const partCount = Math.ceil(blob.size / PART_SIZE);
  
  // Get pre-signed URLs from backend
  const { recordingId, uploadUrls } = await apiClient.initRecording(blob.size, partCount);
  
  // Upload each part
  const parts: { partNumber: number; etag: string }[] = [];
  for (let i = 0; i < partCount; i++) {
    const start = i * PART_SIZE;
    const end = Math.min(start + PART_SIZE, blob.size);
    const part = blob.slice(start, end);
    
    const etag = await this.uploadPartWithRetry(part, uploadUrls[i]);
    parts.push({ partNumber: i + 1, etag });
    
    this.onProgress?.((i + 1) / partCount * 100);
  }
  
  // Complete multipart upload
  return apiClient.completeRecording(recordingId, parts, duration, title);
}
```

### Backend Implementation Notes

**R2 Multipart Upload Flow (recordings.service.ts):**
```typescript
async initRecording(userId: string, estimatedSize: number, partCount: number) {
  const recordingId = uuid();
  const key = `recordings/${recordingId}.webm`;
  
  // Start S3 multipart upload
  const { UploadId } = await this.s3.send(new CreateMultipartUploadCommand({
    Bucket: this.bucketName,
    Key: key,
    ContentType: 'video/webm'
  }));
  
  // Generate pre-signed URLs for each part
  const uploadUrls = await Promise.all(
    Array.from({ length: partCount }, (_, i) => 
      this.getPresignedPartUrl(key, UploadId, i + 1)
    )
  );
  
  // Store upload session
  await this.prisma.uploadSession.create({
    data: {
      recordingId,
      userId,
      uploadId: UploadId,
      status: 'uploading',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000)
    }
  });
  
  return { recordingId, uploadUrls };
}

async completeRecording(recordingId: string, parts: Part[], metadata: RecordingMetadata) {
  const session = await this.prisma.uploadSession.findUnique({
    where: { recordingId }
  });
  
  const key = `recordings/${recordingId}.webm`;
  
  // Complete S3 multipart upload
  await this.s3.send(new CompleteMultipartUploadCommand({
    Bucket: this.bucketName,
    Key: key,
    UploadId: session.uploadId,
    MultipartUpload: { Parts: parts.map(p => ({ PartNumber: p.partNumber, ETag: p.etag })) }
  }));
  
  // Generate share token and save recording
  const shareToken = generateShareToken();
  
  await this.prisma.recording.create({
    data: {
      id: recordingId,
      userId: session.userId,
      title: metadata.title || 'Untitled Recording',
      duration: metadata.duration,
      filePath: key,
      fileSize: metadata.fileSize,
      shareToken,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    }
  });
  
  return { shareUrl: `https://vibly.com/v/${shareToken}` };
}
```

### Security Considerations

**Upload Session Validation:**
- Sessions expire after 15 minutes
- Upload ID is S3-managed (tamper-proof)
- User ID validated on completion

**Rate Limiting:**
```typescript
@Throttle(10, 60) // 10 recording inits per minute
async initRecording() { ... }

@Throttle(5, 60) // 5 logins per minute per IP
async login() { ... }
```

**R2 Access Control:**
- Private bucket (no public read)
- Signed URLs for video access (1-hour expiry)
- Pre-signed upload URLs (15-minute expiry)
- CORS configured for extension origin only

**Content Validation:**
- Verify Content-Type header (video/webm)
- Max file size: 500MB (100 parts × 5MB)
- Validate part sequence on completion

### Development Phases

**Phase 1: Core Recording ✅**
- [x] WXT + Vue 3 extension setup
- [x] Screen capture implementation
- [x] Webcam capture implementation
- [x] Canvas compositor for overlay
- [x] Local download functionality
- [x] Recording UI controls (start/stop/pause)
- [x] Audio mixing (system + microphone)

**Phase 2: Backend Infrastructure ✅**
- [x] NestJS project setup
- [x] PostgreSQL schema & migrations (Prisma)
- [x] Cloudflare R2 integration with S3 SDK
- [x] Authentication endpoints (JWT + refresh tokens)
- [x] Multipart upload init endpoint
- [x] Multipart upload complete endpoint
- [x] Signed URL generation for playback

**Phase 3: Integration ✅**
- [x] Extension API client implementation
- [x] S3 multipart uploader with retry logic
- [x] Progress indicator UI
- [x] Error handling & user feedback
- [x] Share link generation
- [x] Copy-to-clipboard functionality

**Phase 4: Public Player (Pending)**
- [ ] Video player page UI (minimal, fast-loading)
- [ ] Watch endpoint with signed URLs
- [ ] View count tracking
- [ ] Expired recording handling

**Phase 5: Polish & Launch (Pending)**
- [ ] Extension icon & branding
- [ ] Onboarding flow (first-time permission prompts)
- [ ] Chrome Web Store listing prep
- [ ] Landing page (vibly.com)
- [ ] Submit to Chrome Web Store

### Infrastructure Setup

**Cloudflare R2:**
```bash
# Create bucket
wrangler r2 bucket create vibly-recordings

# CORS configuration (via Cloudflare dashboard or API)
{
  "AllowedOrigins": ["chrome-extension://*", "https://vibly.com"],
  "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600
}
```

**Database Schema (Prisma):**
```prisma
model User {
  id               String   @id @default(uuid())
  email            String   @unique
  passwordHash     String
  subscriptionTier String   @default("free")
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  recordings     Recording[]
  uploadSessions UploadSession[]
  refreshTokens  RefreshToken[]
}

model Recording {
  id          String    @id @default(uuid())
  userId      String
  title       String
  duration    Int
  filePath    String
  fileSize    BigInt
  shareToken  String    @unique
  isPublic    Boolean   @default(true)
  viewCount   Int       @default(0)
  createdAt   DateTime  @default(now())
  expiresAt   DateTime?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([shareToken])
  @@index([userId])
}

model UploadSession {
  id            String   @id @default(uuid())
  recordingId   String   @unique
  userId        String
  uploadId      String
  status        String   @default("uploading")
  partsUploaded Int      @default(0)
  createdAt     DateTime @default(now())
  expiresAt     DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([recordingId])
  @@index([status, expiresAt])
}

model RefreshToken {
  id        String   @id @default(uuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([token])
  @@index([userId])
}
```

**Environment Variables:**
```bash
# Backend (.env)
DATABASE_URL=postgresql://user:pass@host:5432/vibly
JWT_SECRET=your-jwt-secret-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-min-32-chars
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_BUCKET_NAME=vibly-recordings

# Extension (utils/constants.ts)
export const API_URL = 'http://localhost:3000'; // or https://api.vibly.com
export const MAX_RECORDING_DURATION = 420; // 7 minutes
export const PART_SIZE = 5 * 1024 * 1024; // 5MB
export const VIDEO_BITRATE = 2_500_000; // 2.5 Mbps
export const VIDEO_FRAMERATE = 30;
```

### Testing Strategy

**Extension Testing:**
- Manual testing across Chrome versions (latest 3 stable)
- Test on different screen resolutions (1080p, 1440p, 4K)
- Test compositor performance on low-end machine (i3/8GB)
- Network interruption scenarios (disconnect during upload)
- Permission denial handling (all combinations)

**Backend Testing:**
- Unit tests for multipart upload flow
- Integration tests for R2 operations
- Load testing for concurrent uploads (simulate 50 users)
- JWT refresh token flow validation

**Critical Test Cases:**
1. Recording at 4K resolution (compositor stress test)
2. 500MB upload (max file size, 100 parts)
3. Network disconnect during upload (retry logic)
4. Invalid/malicious file upload attempts
5. Concurrent recordings from same user
6. Expired upload session handling
7. All permission denial combinations

### Cost Estimates (First 100 Users)

**Assumptions:**
- Average 5-minute recording per user per day (within 7-min limit)
- 30-day retention for free tier
- 2.5 Mbps bitrate = ~93 MB per 5-min video

**Monthly Costs:**
```
Storage: 100 users × 30 recordings × 93 MB = 279 GB
- R2 Storage: 279 GB × $0.015 = $4.19

Bandwidth (R2 egress is free via Cloudflare):
- $0

Compute (Railway/Fly.io):
- Hobby plan: $5-10/month

Database:
- Railway Postgres: Included in hobby plan

Total: ~$10-15/month
```

### Future Enhancements (Post-MVP)

**Phase 2 Features:**
- Google OAuth login
- Trim video (simple start/end cut)
- Password-protected links
- Video thumbnails (generated server-side)
- Privacy toggle (private by default option)
- Draggable webcam position

**Phase 3 Features:**
- Custom domains for enterprises
- Transcription (Whisper API)
- Team workspaces

**Monetization:**
- Free: 5 videos max, 7-min max per video, 30-day retention
- Pro ($5/month): Unlimited recordings, 30-min max per video, permanent storage

### Success Metrics (First 3 Months)

**Acquisition:**
- 500 total signups
- 20% weekly active users (100 WAU)
- 40% recording completion rate

**Engagement:**
- Average 3 recordings per active user per week
- 50% of recordings get shared (link clicked)
- Average 2 views per shared recording

**Technical:**
- <5% upload failure rate
- <10 second average upload time for 5-min video
- 99% uptime

## Getting Started

### Backend Setup
```bash
cd vibly-backend
npm install
cp .env.example .env  # Edit with your credentials
npx prisma generate
npx prisma migrate dev
npm run start:dev
```

### Extension Setup
```bash
cd vibly-extension
npm install
npm run dev
```

Then load the extension:
1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select `vibly-extension/.output/chrome-mv3`

---

**Document Version:** 2.0  
**Last Updated:** 2024-12-26  
**Owner:** Wahyu (Kav & Co)
