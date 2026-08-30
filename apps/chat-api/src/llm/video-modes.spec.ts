import { describe, it, expect } from 'vitest';
import {
  detectVideoMode,
  getOpenRouterVideoCapabilities,
  assertVideoRequestSupported,
  VideoGenerationError,
} from './video-modes';

describe('detectVideoMode', () => {
  it('is text_to_video with no attachments', () => {
    expect(detectVideoMode({})).toBe('text_to_video');
  });

  it('is image_to_video when only reference images are attached', () => {
    expect(detectVideoMode({ referenceImageUrls: ['https://x.test/a.png'] })).toBe('image_to_video');
  });

  it('is unsupported_reference_video when a reference video is attached', () => {
    expect(detectVideoMode({ referenceVideoUrls: ['https://x.test/a.mp4'] })).toBe('unsupported_reference_video');
  });

  it('prefers unsupported_reference_video over image_to_video when both are attached', () => {
    // A prompt like "use this reference video ... replace the baby with the
    // person from this image" attaches both kinds - the video-input intent
    // is what makes the whole request impossible, so it must win detection
    // even though an image is also present.
    expect(
      detectVideoMode({
        referenceImageUrls: ['https://x.test/a.png'],
        referenceVideoUrls: ['https://x.test/a.mp4'],
      })
    ).toBe('unsupported_reference_video');
  });

  it('ignores empty arrays (treats them as absent)', () => {
    expect(detectVideoMode({ referenceImageUrls: [], referenceVideoUrls: [] })).toBe('text_to_video');
  });
});

describe('getOpenRouterVideoCapabilities', () => {
  it('reports no reference-video support, since no OpenRouter video parameter accepts a video file', () => {
    expect(getOpenRouterVideoCapabilities().referenceVideo).toBe(false);
  });

  it('reports text-to-video and image-to-video support', () => {
    const caps = getOpenRouterVideoCapabilities();
    expect(caps.textToVideo).toBe(true);
    expect(caps.imageToVideo).toBe(true);
  });
});

describe('assertVideoRequestSupported', () => {
  const capabilities = getOpenRouterVideoCapabilities();

  it('does not throw for text_to_video', () => {
    expect(() => assertVideoRequestSupported('text_to_video', capabilities)).not.toThrow();
  });

  it('does not throw for image_to_video', () => {
    expect(() => assertVideoRequestSupported('image_to_video', capabilities)).not.toThrow();
  });

  it('throws a non-retryable UNSUPPORTED_REFERENCE_VIDEO error for unsupported_reference_video', () => {
    try {
      assertVideoRequestSupported('unsupported_reference_video', capabilities);
      expect.unreachable('expected assertVideoRequestSupported to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(VideoGenerationError);
      const videoError = error as VideoGenerationError;
      expect(videoError.code).toBe('UNSUPPORTED_REFERENCE_VIDEO');
      expect(videoError.retryable).toBe(false);
      // The whole point of this gate: the reason must be legible to an end
      // user (rendered as the assistant's ⚠️ message), not a generic string.
      expect(videoError.message).toMatch(/video/i);
    }
  });

  it('never lets an unsupported_reference_video request reach a state where it would be retried automatically', () => {
    // Regression guard for the "never enter an infinite/repeated failed-
    // generation loop" requirement - retryable:false is what the caller
    // relies on to not auto-retry.
    try {
      assertVideoRequestSupported('unsupported_reference_video', capabilities);
    } catch (error) {
      expect((error as VideoGenerationError).retryable).toBe(false);
      return;
    }
    expect.unreachable('expected assertVideoRequestSupported to throw');
  });
});
