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
- Manifest V3
- Vanilla JavaScript (no framework for minimal bundle size)
- Canvas API for webcam overlay compositing
- MediaRecorder API for video capture

**Backend:**
- NestJS (TypeScript)
- PostgreSQL (metadata storage)
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
- Webcam overlay (bottom-right corner, draggable)
- Real-time recording status indicator
- Stop/pause controls

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
  password_hash: string
  created_at: timestamp
  subscription_tier: enum ('free', 'pro')
}
```

**Recording:**
```typescript
{
  id: uuid
  user_id: uuid (foreign key)
  title: string
  duration: integer (seconds)
  file_path: string (R2 object key)
  file_size: bigint (bytes)
  share_token: string (unique, indexed)
  is_public: boolean
  view_count: integer
  created_at: timestamp
  expires_at: timestamp (optional, for free tier)
}
```

**UploadSession:**
```typescript
{
  id: uuid
  recording_id: uuid
  user_id: uuid
  upload_id: string (S3 multipart upload ID)
  status: enum ('pending', 'uploading', 'completed', 'failed', 'expired')
  parts_uploaded: integer
  total_size: bigint
  created_at: timestamp
  expires_at: timestamp (15 minutes from creation)
}
```

### API Endpoints

**Authentication:**
```
POST /api/auth/register
  → Body: { email, password }
  → Returns: { access_token, refresh_token, user }

POST /api/auth/login
  → Body: { email, password }
  → Returns: { access_token, refresh_token, user }

POST /api/auth/refresh
  → Body: { refresh_token }
  → Returns: { access_token }
```

**Recording Management:**
```
POST /api/recordings/init
  → Returns: { recording_id, upload_id, upload_urls[] }
  → Note: Returns pre-signed URLs for each part (up to 100 parts)

POST /api/recordings/:id/complete
  → Body: { parts: [{ part_number, etag }], duration, title? }
  → Returns: { share_url, share_token }

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
├── manifest.json
├── background/
│   └── service-worker.js      # Handle permissions, state management
├── content/
│   └── overlay.js             # Webcam positioning UI (injected into page)
├── popup/
│   ├── popup.html             # Extension popup UI
│   ├── popup.css
│   └── popup.js               # Recording controls + state
├── lib/
│   ├── media-handler.js       # MediaRecorder wrapper
│   ├── compositor.js          # Canvas-based screen+webcam merge
│   ├── uploader.js            # S3 multipart upload logic
│   └── api-client.js          # Backend API calls
├── assets/
│   ├── icons/                 # 16x16, 48x48, 128x128
│   └── styles/
└── config/
    └── constants.js           # API URLs, chunk size, etc.
```

### Extension Error States & UX

**Permission Errors:**
| Error | User Message | Action |
|-------|--------------|--------|
| Screen permission denied | "Screen access denied. Click to try again." | Re-prompt permission |
| Webcam permission denied | "Camera access denied. Recording without webcam." | Continue without webcam |
| No audio device | "No microphone found. Recording without audio." | Continue without audio |

**Recording Errors:**
| Error | User Message | Action |
|-------|--------------|--------|
| MediaRecorder not supported | "Your browser doesn't support recording." | Show Chrome version requirement |
| Recording failed to start | "Couldn't start recording. Please try again." | Reset state, allow retry |
| Tab closed during recording | "Recording stopped - tab was closed." | Save partial recording if possible |

**Upload Errors:**
| Error | User Message | Action |
|-------|--------------|--------|
| Network offline | "No internet connection. Will retry when online." | Queue for retry, show pending state |
| Upload timeout | "Upload taking too long. Retrying..." | Auto-retry with backoff |
| Server error (5xx) | "Server error. Retrying in X seconds..." | Auto-retry 3x, then show manual retry |
| Auth expired | "Session expired. Please log in again." | Redirect to login, preserve recording locally |
| Upload failed (after retries) | "Upload failed. Click to retry or download locally." | Offer local download as fallback |

**Progress States:**
- Recording: Show duration timer + red dot indicator
- Processing: "Preparing video..." (brief, during blob finalization)
- Uploading: Progress bar with percentage + "Uploading... X%" 
- Complete: "Link copied!" with share URL visible

### Key Implementation Details

**Webcam Overlay Compositing:**
```javascript
// Composite screen + webcam into single stream
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');

// Set canvas size to screen resolution
canvas.width = screenStream.getVideoTracks()[0].getSettings().width;
canvas.height = screenStream.getVideoTracks()[0].getSettings().height;

function composite() {
  // Draw screen frame
  ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
  
  // Draw webcam overlay (bottom-right, 20% width)
  const webcamWidth = canvas.width * 0.2;
  const webcamHeight = webcamWidth * 0.75; // 4:3 ratio
  const x = canvas.width - webcamWidth - 20;
  const y = canvas.height - webcamHeight - 20;
  
  ctx.drawImage(webcamVideo, x, y, webcamWidth, webcamHeight);
  
  requestAnimationFrame(composite);
}

const outputStream = canvas.captureStream(30); // 30 fps
```

**⚠️ Performance Note:** Canvas compositing at 30fps is CPU-intensive. Test on:
- Low-end machines (i3, 8GB RAM)
- 4K displays (higher resolution = more work)
- Long recordings (>10 min) for memory leaks

If performance issues arise, consider:
1. Reducing compositor fps to 24
2. Downscaling canvas to 1080p max regardless of screen resolution
3. Using OffscreenCanvas in a Web Worker (Manifest V3 compatible)

**S3 Multipart Upload Strategy:**
```javascript
// R2 is S3-compatible - use native multipart upload
const PART_SIZE = 5 * 1024 * 1024; // 5MB minimum for S3

async function uploadRecording(blob, recordingId, uploadUrls) {
  const parts = [];
  const totalParts = Math.ceil(blob.size / PART_SIZE);
  
  for (let i = 0; i < totalParts; i++) {
    const start = i * PART_SIZE;
    const end = Math.min(start + PART_SIZE, blob.size);
    const part = blob.slice(start, end);
    
    const etag = await uploadPartWithRetry(part, uploadUrls[i], i + 1);
    parts.push({ part_number: i + 1, etag });
    
    // Report progress
    onProgress((i + 1) / totalParts * 100);
  }
  
  // Complete multipart upload via backend
  return await completeUpload(recordingId, parts);
}

async function uploadPartWithRetry(part, presignedUrl, partNumber, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(presignedUrl, {
        method: 'PUT',
        body: part,
        headers: { 'Content-Type': 'video/webm' }
      });
      
      // ETag is required for completing multipart upload
      return response.headers.get('ETag');
    } catch (error) {
      if (attempt === retries - 1) throw error;
      await sleep(Math.pow(2, attempt) * 1000); // Exponential backoff
    }
  }
}
```

### Backend Implementation Notes

**R2 Multipart Upload Flow:**
```typescript
// recordings.service.ts
import { S3Client, CreateMultipartUploadCommand, CompleteMultipartUploadCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

async initRecording(userId: string, estimatedSize: number) {
  const recordingId = uuid();
  const key = `recordings/${recordingId}.webm`;
  
  // Start S3 multipart upload
  const { UploadId } = await this.s3.send(new CreateMultipartUploadCommand({
    Bucket: this.bucketName,
    Key: key,
    ContentType: 'video/webm'
  }));
  
  // Calculate number of parts needed (5MB each, max 100 parts = 500MB)
  const partCount = Math.min(Math.ceil(estimatedSize / (5 * 1024 * 1024)), 100);
  
  // Generate pre-signed URLs for each part
  const uploadUrls = await Promise.all(
    Array.from({ length: partCount }, (_, i) => 
      this.getPresignedPartUrl(key, UploadId, i + 1)
    )
  );
  
  // Store upload session
  await this.db.uploadSessions.create({
    id: uuid(),
    recording_id: recordingId,
    user_id: userId,
    upload_id: UploadId,
    status: 'uploading',
    expires_at: new Date(Date.now() + 15 * 60 * 1000) // 15 min
  });
  
  return { recording_id: recordingId, upload_id: UploadId, upload_urls: uploadUrls };
}

async completeRecording(recordingId: string, parts: Part[], metadata: RecordingMetadata) {
  const session = await this.db.uploadSessions.findByRecordingId(recordingId);
  const key = `recordings/${recordingId}.webm`;
  
  // Complete S3 multipart upload - this combines all parts automatically
  await this.s3.send(new CompleteMultipartUploadCommand({
    Bucket: this.bucketName,
    Key: key,
    UploadId: session.upload_id,
    MultipartUpload: { Parts: parts.map(p => ({ PartNumber: p.part_number, ETag: p.etag })) }
  }));
  
  // Generate share token
  const shareToken = generateShareToken(); // 12-char alphanumeric
  
  // Get final file size
  const headResponse = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
  
  // Save recording to database
  await this.db.recordings.create({
    id: recordingId,
    user_id: session.user_id,
    title: metadata.title || 'Untitled Recording',
    duration: metadata.duration,
    file_path: key,
    file_size: headResponse.ContentLength,
    share_token: shareToken,
    is_public: true,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days for free tier
  });
  
  // Mark upload session complete
  await this.db.uploadSessions.update(session.id, { status: 'completed' });
  
  return { share_url: `https://vibly.com/v/${shareToken}`, share_token: shareToken };
}
```

**Video Streaming Endpoint:**
```typescript
// watch.controller.ts

@Get('watch/:shareToken')
async getRecording(@Param('shareToken') token: string) {
  const recording = await this.recordingsService.findByToken(token);
  
  if (!recording) {
    throw new NotFoundException('Recording not found');
  }
  
  if (recording.expires_at && recording.expires_at < new Date()) {
    throw new GoneException('Recording has expired');
  }
  
  // Generate signed R2 URL (1-hour expiry)
  const videoUrl = await this.r2.getSignedUrl(recording.file_path, 3600);
  
  // Increment view count (async, non-blocking)
  this.recordingsService.incrementViews(recording.id);
  
  return {
    title: recording.title,
    duration: recording.duration,
    video_url: videoUrl,
    created_at: recording.created_at
  };
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

**Phase 1: Core Recording (Week 1-2)**
- [ ] Chrome extension boilerplate with Manifest V3
- [ ] Screen capture implementation
- [ ] Webcam capture implementation
- [ ] Canvas compositor for overlay
- [ ] Local download functionality (validation before cloud)
- [ ] Recording UI controls (start/stop/pause)
- [ ] Test compositor on low-end machine + 4K display

**Phase 2: Backend Infrastructure (Week 2-3)**
- [ ] NestJS project setup
- [ ] PostgreSQL schema & migrations (User, Recording, UploadSession)
- [ ] Cloudflare R2 integration with S3 SDK
- [ ] Authentication endpoints (JWT + refresh tokens)
- [ ] Multipart upload init endpoint
- [ ] Multipart upload complete endpoint
- [ ] Signed URL generation for playback

**Phase 3: Integration (Week 3)**
- [ ] Extension API client implementation
- [ ] S3 multipart uploader with retry logic
- [ ] Progress indicator UI
- [ ] Error handling & user feedback (all error states)
- [ ] Share link generation
- [ ] Copy-to-clipboard functionality
- [ ] Offline detection + retry queue

**Phase 4: Public Player (Week 4)**
- [ ] Video player page UI (minimal, fast-loading)
- [ ] Watch endpoint with signed URLs
- [ ] View count tracking
- [ ] Expired recording handling

**Phase 5: Polish & Launch (Week 4-5)**
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

**Database Migration (Prisma):**
```prisma
model User {
  id               String   @id @default(uuid())
  email            String   @unique
  passwordHash     String
  subscriptionTier String   @default("free") // 'free' | 'pro'
  createdAt        DateTime @default(now())
  
  recordings     Recording[]
  uploadSessions UploadSession[]
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
  
  user User @relation(fields: [userId], references: [id])
  
  @@index([shareToken])
  @@index([userId])
}

model UploadSession {
  id           String   @id @default(uuid())
  recordingId  String   @unique
  userId       String
  uploadId     String   // S3 multipart upload ID
  status       String   @default("uploading") // 'uploading' | 'completed' | 'failed' | 'expired'
  partsUploaded Int     @default(0)
  createdAt    DateTime @default(now())
  expiresAt    DateTime
  
  user User @relation(fields: [userId], references: [id])
  
  @@index([recordingId])
  @@index([status, expiresAt]) // For cleanup job
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
API_URL=https://api.vibly.com
FRONTEND_URL=https://vibly.com

# Extension (config/constants.js)
const API_URL = 'https://api.vibly.com';
const MAX_RECORDING_DURATION = 420; // 7 minutes for free tier (configurable)
const PART_SIZE = 5 * 1024 * 1024; // 5MB (S3 minimum)
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
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

**Note:** Browser crash recovery is NOT supported in MVP. MediaRecorder doesn't support incremental saves. If needed later, consider periodic blob snapshots to IndexedDB.

### Monitoring & Observability

**Metrics to Track:**
- Recording completion rate (started vs finalized)
- Average upload time by file size
- Failed upload rate (by error type)
- Video playback errors
- Storage usage growth rate

**Logging:**
```typescript
// Structured logging with context
logger.info('Recording finalized', {
  recording_id: recordingId,
  duration: metadata.duration,
  file_size: totalSize,
  parts: parts.length,
  upload_time_ms: uploadDuration
});

logger.warn('Upload retry', {
  recording_id: recordingId,
  part_number: partNumber,
  attempt: attempt,
  error: error.message
});
```

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

### Initial Setup Commands
```bash
# Create project directories
mkdir vibly-extension vibly-backend

# Backend setup
cd vibly-backend
npx @nestjs/cli new . --package-manager npm
npm install @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt
npm install @prisma/client @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm install --save-dev prisma @types/bcrypt @types/passport-jwt
npx prisma init
```

### Priority Order for Development

1. **Extension: Local Recording First**
   - `manifest.json` - Extension config
   - `lib/media-handler.js` - MediaRecorder wrapper
   - `lib/compositor.js` - Screen + webcam merge
   - `popup/popup.html` + `popup.js` - UI
   - Goal: Record and download locally (validate before cloud)

2. **Backend: Upload Infrastructure**
   - `prisma/schema.prisma` - All models
   - `src/r2/r2.service.ts` - S3 multipart operations
   - `src/recordings/recordings.service.ts` - Init + complete flow
   - `src/auth/` - JWT authentication
   - Goal: Accept uploads, return share links

3. **Integration: End-to-End**
   - `lib/uploader.js` - S3 multipart client
   - `lib/api-client.js` - Auth + API calls
   - Goal: Record → Upload → Share link works

### Development Best Practices

- Keep extension bundle size <500KB
- Test compositor on low-end hardware early
- Use feature flags for gradual rollout
- Version extension with semver (start 0.1.0)
- Log upload failures with full context for debugging

---

**Document Version:** 1.1  
**Last Updated:** 2024-12-25  
**Owner:** Wahyu (Kav & Co)
