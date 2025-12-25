import { PART_SIZE } from '../config/constants.js';
import { apiClient } from './api-client.js';

export class Uploader {
  constructor() {
    this.onProgress = null;
  }

  async upload(blob, duration, title = 'Untitled Recording') {
    const totalParts = Math.ceil(blob.size / PART_SIZE);
    
    console.log('Starting upload', {
      blobSize: blob.size,
      totalParts,
      partSize: PART_SIZE,
    });

    // Initialize upload
    const { recordingId, uploadUrls } = await apiClient.initRecording(
      blob.size,
      totalParts
    );

    console.log('Upload initialized', { recordingId, urlCount: uploadUrls.length });

    // Upload parts
    const parts = [];
    for (let i = 0; i < totalParts; i++) {
      const start = i * PART_SIZE;
      const end = Math.min(start + PART_SIZE, blob.size);
      const part = blob.slice(start, end);

      const etag = await this.uploadPartWithRetry(part, uploadUrls[i], i + 1);
      parts.push({ partNumber: i + 1, etag });

      // Report progress
      const progress = ((i + 1) / totalParts) * 100;
      if (this.onProgress) {
        this.onProgress(progress);
      }
      console.log(`Part ${i + 1}/${totalParts} uploaded, progress: ${progress.toFixed(1)}%`);
    }

    // Complete upload
    const result = await apiClient.completeRecording(
      recordingId,
      parts,
      duration,
      title
    );

    console.log('Upload complete', result);
    return result;
  }

  async uploadPartWithRetry(part, presignedUrl, partNumber, maxRetries = 3) {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(presignedUrl, {
          method: 'PUT',
          body: part,
          headers: {
            'Content-Type': 'video/webm',
          },
        });

        if (!response.ok) {
          throw new Error(`Upload failed with status ${response.status}`);
        }

        // Get ETag from response headers
        const etag = response.headers.get('ETag');
        if (!etag) {
          throw new Error('No ETag in response');
        }

        return etag.replace(/"/g, ''); // Remove quotes from ETag
      } catch (error) {
        lastError = error;
        console.warn(`Part ${partNumber} upload attempt ${attempt + 1} failed:`, error);

        if (attempt < maxRetries - 1) {
          // Exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }
}

export const uploader = new Uploader();
