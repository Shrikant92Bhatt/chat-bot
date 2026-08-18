import * as dotenv from 'dotenv';
import { Storage } from '@google-cloud/storage';

dotenv.config();

/**
 * Uploads generated assets to Google Cloud Storage. Falls back to a mock
 * URL (no network call) when GCS_BUCKET_NAME isn't set, so local
 * development works without GCP access.
 *
 * Credentials are NOT required to be explicit: the Storage client resolves
 * them via Application Default Credentials, which covers both a local
 * GOOGLE_APPLICATION_CREDENTIALS key file and a Cloud Run service's
 * attached service account (which never sets that env var).
 */
export class GcsUploader {
  private bucketName: string;
  private isConfigured: boolean;
  private storage: Storage | null = null;

  constructor() {
    this.bucketName = process.env.GCS_BUCKET_NAME || 'nexusai-generated-images';
    this.isConfigured = !!process.env.GCS_BUCKET_NAME;

    if (this.isConfigured) {
      this.storage = new Storage();
    }
  }

  async uploadImage(buffer: Buffer, fileName: string, contentType = 'image/png'): Promise<string> {
    if (!this.isConfigured || !this.storage) {
      console.warn(`[GcsUploader] GCS is not configured. Returning mock URL for ${fileName}.`);
      return `https://storage.googleapis.com/${this.bucketName}/${fileName}`;
    }

    try {
      const file = this.storage.bucket(this.bucketName).file(fileName);
      await file.save(buffer, { contentType, resumable: false });
      return `https://storage.googleapis.com/${this.bucketName}/${fileName}`;
    } catch (error) {
      console.error('[GcsUploader] Upload failed:', error);
      throw new Error('Image upload failed.');
    }
  }

  isReady(): boolean {
    return this.isConfigured;
  }

  getBucketName(): string {
    return this.bucketName;
  }
}
