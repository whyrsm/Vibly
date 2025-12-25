import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../r2/r2.service';
import { InitRecordingDto, CompleteRecordingDto } from './dto/recordings.dto';

const FREE_TIER_MAX_RECORDINGS = 5;
const FREE_TIER_RETENTION_DAYS = 30;

@Injectable()
export class RecordingsService {
  constructor(
    private prisma: PrismaService,
    private r2Service: R2Service,
  ) {}

  async initRecording(userId: string, dto: InitRecordingDto) {
    // Check recording limit for free tier
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (user.subscriptionTier === 'free') {
      const recordingCount = await this.prisma.recording.count({
        where: { userId },
      });

      if (recordingCount >= FREE_TIER_MAX_RECORDINGS) {
        throw new ForbiddenException(
          `Free tier limited to ${FREE_TIER_MAX_RECORDINGS} recordings`,
        );
      }
    }

    const recordingId = uuid();
    const key = `recordings/${recordingId}.webm`;

    // Create multipart upload
    const uploadId = await this.r2Service.createMultipartUpload(key);

    // Generate presigned URLs for each part
    const uploadUrls = await this.r2Service.getPresignedUploadUrls(
      key,
      uploadId,
      dto.partCount,
    );

    // Store upload session
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.prisma.uploadSession.create({
      data: {
        id: uuid(),
        recordingId,
        userId,
        uploadId,
        status: 'uploading',
        expiresAt,
      },
    });

    return {
      recordingId,
      uploadId,
      uploadUrls,
    };
  }

  async completeRecording(
    userId: string,
    recordingId: string,
    dto: CompleteRecordingDto,
  ) {
    const session = await this.prisma.uploadSession.findUnique({
      where: { recordingId },
    });

    if (!session) {
      throw new NotFoundException('Upload session not found');
    }

    if (session.userId !== userId) {
      throw new ForbiddenException('Not authorized');
    }

    if (session.status !== 'uploading') {
      throw new BadRequestException('Upload session is not active');
    }

    if (session.expiresAt < new Date()) {
      throw new BadRequestException('Upload session expired');
    }

    const key = `recordings/${recordingId}.webm`;

    // Complete multipart upload
    const parts = dto.parts.map((p) => ({
      PartNumber: p.partNumber,
      ETag: p.etag,
    }));

    await this.r2Service.completeMultipartUpload(key, session.uploadId, parts);

    // Get file size
    const metadata = await this.r2Service.getObjectMetadata(key);
    const fileSize = metadata?.contentLength || 0;

    // Generate share token
    const shareToken = this.generateShareToken();

    // Calculate expiration for free tier
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    const expiresAt =
      user.subscriptionTier === 'free'
        ? new Date(
            Date.now() + FREE_TIER_RETENTION_DAYS * 24 * 60 * 60 * 1000,
          )
        : null;

    // Create recording
    const recording = await this.prisma.recording.create({
      data: {
        id: recordingId,
        userId,
        title: dto.title || 'Untitled Recording',
        duration: dto.duration,
        filePath: key,
        fileSize: BigInt(fileSize),
        shareToken,
        isPublic: true,
        expiresAt,
      },
    });

    // Update upload session
    await this.prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'completed' },
    });

    return {
      shareUrl: `${process.env.FRONTEND_URL}/v/${shareToken}`,
      shareToken,
      recording: {
        id: recording.id,
        title: recording.title,
        duration: recording.duration,
        createdAt: recording.createdAt,
      },
    };
  }

  private generateShareToken(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = '';
    for (let i = 0; i < 12; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }

  async getUserRecordings(userId: string) {
    const recordings = await this.prisma.recording.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        duration: true,
        shareToken: true,
        viewCount: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    return recordings.map((r) => ({
      ...r,
      shareUrl: `${process.env.FRONTEND_URL}/v/${r.shareToken}`,
    }));
  }

  async deleteRecording(userId: string, recordingId: string) {
    const recording = await this.prisma.recording.findUnique({
      where: { id: recordingId },
    });

    if (!recording) {
      throw new NotFoundException('Recording not found');
    }

    if (recording.userId !== userId) {
      throw new ForbiddenException('Not authorized');
    }

    // Delete from R2
    await this.r2Service.deleteObject(recording.filePath);

    // Delete from database
    await this.prisma.recording.delete({
      where: { id: recordingId },
    });

    return { message: 'Recording deleted' };
  }

  async getRecordingByShareToken(shareToken: string) {
    const recording = await this.prisma.recording.findUnique({
      where: { shareToken },
    });

    if (!recording) {
      throw new NotFoundException('Recording not found');
    }

    if (recording.expiresAt && recording.expiresAt < new Date()) {
      throw new NotFoundException('Recording has expired');
    }

    // Generate signed URL for video
    const videoUrl = await this.r2Service.getSignedDownloadUrl(
      recording.filePath,
      3600,
    );

    // Increment view count (non-blocking)
    this.prisma.recording
      .update({
        where: { id: recording.id },
        data: { viewCount: { increment: 1 } },
      })
      .catch(() => {});

    return {
      title: recording.title,
      duration: recording.duration,
      videoUrl,
      createdAt: recording.createdAt,
    };
  }
}
