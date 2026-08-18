import { Storage } from '@google-cloud/storage';

export interface StorageMetrics {
  bucketName: string;
  totalSizeBytes: number;
  totalSizeMB: string;
  totalSizeGB: string;
  objectCount: number;
  estimatedMonthlyCostUSD: string;
  lastUpdated: string;
  configured: boolean;
}

/**
 * Computes real GCS bucket size/object-count metrics by listing bucket
 * contents. Falls back to zeroed, clearly-flagged metrics when GCS isn't
 * configured, rather than fabricating numbers.
 */
export class StorageMetricsService {
  private static readonly COST_PER_GB_USD = 0.02;

  async getBucketMetrics(): Promise<StorageMetrics> {
    const bucketName = process.env.GCS_BUCKET_NAME || 'nexusai-generated-images';
    const configured = !!process.env.GCS_BUCKET_NAME;

    if (!configured) {
      console.warn('[StorageMetricsService] GCS not configured; returning zeroed metrics.');
      return {
        bucketName,
        totalSizeBytes: 0,
        totalSizeMB: '0.00',
        totalSizeGB: '0.00',
        objectCount: 0,
        estimatedMonthlyCostUSD: '0.0000',
        lastUpdated: new Date().toISOString(),
        configured: false,
      };
    }

    try {
      const storage = new Storage();
      const [files] = await storage.bucket(bucketName).getFiles();
      const totalBytes = files.reduce((sum, file) => sum + Number(file.metadata.size || 0), 0);

      return {
        bucketName,
        totalSizeBytes: totalBytes,
        totalSizeMB: (totalBytes / (1024 * 1024)).toFixed(2),
        totalSizeGB: (totalBytes / (1024 * 1024 * 1024)).toFixed(2),
        objectCount: files.length,
        estimatedMonthlyCostUSD: ((totalBytes / (1024 * 1024 * 1024)) * StorageMetricsService.COST_PER_GB_USD).toFixed(4),
        lastUpdated: new Date().toISOString(),
        configured: true,
      };
    } catch (error) {
      console.error('[StorageMetricsService] Failed to fetch bucket metrics:', error);
      throw new Error('Failed to retrieve storage metrics from GCS.');
    }
  }
}
