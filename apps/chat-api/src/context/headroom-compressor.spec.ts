import { describe, it, expect } from 'vitest';
import { HeadroomCompressor } from './headroom-compressor';

describe('HeadroomCompressor Unit Tests', () => {
  it('should pass through short text strings without compression', () => {
    const input = ['Short context string'];
    const result = HeadroomCompressor.compressRagChunks(input);

    expect(result.chunks).toEqual(input);
    expect(result.metrics.wasCompressed).toBe(false);
  });

  it('should minify valid JSON payloads', () => {
    const jsonPayload = JSON.stringify({ key: 'value', number: 123, list: [1, 2, 3] }, null, 2);
    // Pad to exceed short-string threshold
    const verboseJson = jsonPayload + '\n' + ' '.repeat(160);

    const result = HeadroomCompressor.compressRagChunks([verboseJson]);

    expect(result.metrics.wasCompressed).toBe(true);
    expect(result.metrics.ratioPercent).toBeGreaterThan(0);
  });

  it('should structural-truncate context blocks exceeding 1000 characters', () => {
    const oversizedText = 'A'.repeat(1200);
    const result = HeadroomCompressor.compressRagChunks([oversizedText]);

    expect(result.chunks[0]).toContain('[Headroom compressed');
    expect(result.metrics.wasCompressed).toBe(true);
  });
});
