import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class R2Service {
  private s3Client: S3Client;
  private bucketName: string;

  constructor(private configService: ConfigService) {
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: this.configService.get('R2_ENDPOINT'),
      credentials: {
        accessKeyId: this.configService.get('R2_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.get('R2_SECRET_ACCESS_KEY'),
      },
    });
    this.bucketName = this.configService.get('R2_BUCKET_NAME');
  }

  async createMultipartUpload(key: string): Promise<string> {
    const command = new CreateMultipartUploadCommand({
      Bucket: this.bucketName,
      Key: key,
      ContentType: 'video/webm',
    });

    const response = await this.s3Client.send(command);
    return response.UploadId;
  }

  async getPresignedUploadUrl(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: this.bucketName,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn: 900 }); // 15 min
  }

  async getPresignedUploadUrls(
    key: string,
    uploadId: string,
    partCount: number,
  ): Promise<string[]> {
    const urls = await Promise.all(
      Array.from({ length: partCount }, (_, i) =>
        this.getPresignedUploadUrl(key, uploadId, i + 1),
      ),
    );
    return urls;
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { PartNumber: number; ETag: string }[],
  ): Promise<void> {
    const command = new CompleteMultipartUploadCommand({
      Bucket: this.bucketName,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    });

    await this.s3Client.send(command);
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    const command = new AbortMultipartUploadCommand({
      Bucket: this.bucketName,
      Key: key,
      UploadId: uploadId,
    });

    await this.s3Client.send(command);
  }

  async getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  async getObjectMetadata(
    key: string,
  ): Promise<{ contentLength: number } | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      return { contentLength: response.ContentLength || 0 };
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    await this.s3Client.send(command);
  }
}
