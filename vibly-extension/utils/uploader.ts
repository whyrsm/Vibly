import { PART_SIZE } from './constants';
import { apiClient } from './api-client';

export class Uploader {
  onProgress: ((progress: number) => void) | null = null;

  async upload(blob: Blob, duration: number, title = 'Untitled Recording'): Promise<{ shareUrl: string }> {
    const totalParts = Math.ceil(blob.size / PART_SIZE);
    const { recordingId, uploadUrls } = await apiClient.initRecording(blob.size, totalParts);

    const parts: { partNumber: number; etag: string }[] = [];
    for (let i = 0; i < totalParts; i++) {
      const start = i * PART_SIZE;
      const end = Math.min(start + PART_SIZE, blob.size);
      const part = blob.slice(start, end);

      const etag = await this.uploadPartWithRetry(part, uploadUrls[i], i + 1);
      parts.push({ partNumber: i + 1, etag });

      const progress = ((i + 1) / totalParts) * 100;
      this.onProgress?.(progress);
    }

    return apiClient.completeRecording(recordingId, parts, duration, title);
  }

  private async uploadPartWithRetry(part: Blob, presignedUrl: string, partNumber: number, maxRetries = 3): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(presignedUrl, {
          method: 'PUT',
          body: part,
          headers: { 'Content-Type': 'video/webm' },
        });

        if (!response.ok) throw new Error(`Upload failed with status ${response.status}`);

        const etag = response.headers.get('ETag');
        if (!etag) throw new Error('No ETag in response');

        return etag.replace(/"/g, '');
      } catch (error: any) {
        lastError = error;
        console.warn(`Part ${partNumber} upload attempt ${attempt + 1} failed:`, error);
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }
    throw lastError;
  }
}

export const uploader = new Uploader();
