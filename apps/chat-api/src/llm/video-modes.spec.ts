import { describe, it, expect } from 'vitest';
import { validateVideoGenerationRequest, VideoProviderCapabilities } from '@chat-monorepo/shared';
import { detectVideoMode, getOpenRouterVideoCapabilities, assertVideoRequestSupported, VideoGenerationError } from './video-modes';

describe('detectVideoMode', () => {
  it('is text_to_video with no attachments', () => {
    expect(detectVideoMode({})).toBe('text_to_video');
  });

  it('is image_to_video when only reference images are attached', () => {
    expect(detectVideoMode({ referenceImageUrls: ['https://x.test/a.png'] })).toBe('image_to_video');
  });

  it('is image_to_video with multiple reference images', () => {
    expect(
      detectVideoMode({ referenceImageUrls: ['https://x.test/a.png', 'https://x.test/b.png', 'https://x.test/c.png'] })
    ).toBe('image_to_video');
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

/**
 * Test cases from the mobile-UI bug report ("4 image thumbnails staged, but
 * the video-reference warning shows anyway"). Each case is exactly what the
 * shared validateVideoGenerationRequest() - used identically by the
 * frontend's pre-submit warning and this backend's pre-provider-call gate -
 * decides for a given combination of staged attachments. Case 4/5 (a video
 * attached) reproduce what SHOULD trigger the warning; cases 2/3 (images
 * only, including multiple) are the exact shape reported as incorrectly
 * triggering it, and must never be flagged.
 */
describe('validateVideoGenerationRequest (mobile bug report test matrix)', () => {
  const openRouterCapabilities = getOpenRouterVideoCapabilities();

  it('case 1: no attachment - valid, text_to_video', () => {
    const result = validateVideoGenerationRequest({ capabilities: openRouterCapabilities });
    expect(result).toEqual({ valid: true, mode: 'text_to_video' });
  });

  it('case 2: one image - valid, image_to_video, no warning', () => {
    const result = validateVideoGenerationRequest({
      referenceImageUrls: ['https://x.test/baby1.jpg'],
      capabilities: openRouterCapabilities,
    });
    expect(result.valid).toBe(true);
    expect(result.mode).toBe('image_to_video');
    expect(result.warning).toBeUndefined();
  });

  it('case 3: multiple images (the exact reported scenario - 4 image thumbnails) - valid, no warning', () => {
    const result = validateVideoGenerationRequest({
      referenceImageUrls: [
        'https://x.test/baby1.jpg',
        'https://x.test/baby2.jpg',
        'https://x.test/baby3.jpg',
        'https://x.test/baby4.jpg',
      ],
      capabilities: openRouterCapabilities,
    });
    expect(result.valid).toBe(true);
    expect(result.mode).toBe('image_to_video');
    expect(result.warning).toBeUndefined();
  });

  it('case 4: one video - invalid, clear warning naming the actual limitation', () => {
    const result = validateVideoGenerationRequest({
      referenceVideoUrls: ['https://x.test/dance.mp4'],
      capabilities: openRouterCapabilities,
    });
    expect(result.valid).toBe(false);
    expect(result.mode).toBe('unsupported_reference_video');
    expect(result.warning).toMatch(/reference-video/i);
  });

  it('case 5: video + image (character-replacement intent) - invalid for this provider, warning explains why', () => {
    const result = validateVideoGenerationRequest({
      referenceImageUrls: ['https://x.test/person.jpg'],
      referenceVideoUrls: ['https://x.test/dance.mp4'],
      capabilities: openRouterCapabilities,
    });
    expect(result.valid).toBe(false);
    expect(result.mode).toBe('unsupported_reference_video');
  });

  it('case 6: a provider that DOES support image-to-video - images valid', () => {
    const capableProvider: VideoProviderCapabilities = { textToVideo: true, imageToVideo: true, referenceVideo: false };
    const result = validateVideoGenerationRequest({ referenceImageUrls: ['https://x.test/a.jpg'], capabilities: capableProvider });
    expect(result.valid).toBe(true);
  });

  it('case 7: a hypothetical provider that DOES support reference-video - video valid, not rejected', () => {
    const capableProvider: VideoProviderCapabilities = { textToVideo: true, imageToVideo: true, referenceVideo: true };
    const result = validateVideoGenerationRequest({ referenceVideoUrls: ['https://x.test/dance.mp4'], capabilities: capableProvider });
    expect(result.valid).toBe(true);
    expect(result.mode).toBe('unsupported_reference_video');
  });

  it('case 8: current OpenRouter capabilities reject reference-video (unsupported provider case)', () => {
    const result = validateVideoGenerationRequest({
      referenceVideoUrls: ['https://x.test/dance.mp4'],
      capabilities: openRouterCapabilities,
    });
    expect(result.valid).toBe(false);
  });

  it('includes the model name in the warning when provided, without changing the verdict', () => {
    const withoutName = validateVideoGenerationRequest({
      referenceVideoUrls: ['https://x.test/a.mp4'],
      capabilities: openRouterCapabilities,
    });
    const withName = validateVideoGenerationRequest({
      referenceVideoUrls: ['https://x.test/a.mp4'],
      capabilities: openRouterCapabilities,
      modelName: 'Veo 3.1',
    });
    expect(withoutName.valid).toBe(false);
    expect(withName.valid).toBe(false);
    expect(withName.warning).toContain('Veo 3.1');
  });
});

describe('assertVideoRequestSupported', () => {
  const capabilities = getOpenRouterVideoCapabilities();

  it('does not throw for text_to_video', () => {
    expect(() => assertVideoRequestSupported({ capabilities })).not.toThrow();
  });

  it('does not throw for image_to_video, including multiple images', () => {
    expect(() =>
      assertVideoRequestSupported({
        referenceImageUrls: ['https://x.test/a.png', 'https://x.test/b.png', 'https://x.test/c.png', 'https://x.test/d.png'],
        capabilities,
      })
    ).not.toThrow();
  });

  it('throws a non-retryable UNSUPPORTED_REFERENCE_VIDEO error for unsupported_reference_video', () => {
    try {
      assertVideoRequestSupported({ referenceVideoUrls: ['https://x.test/a.mp4'], capabilities });
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
      assertVideoRequestSupported({ referenceVideoUrls: ['https://x.test/a.mp4'], capabilities });
    } catch (error) {
      expect((error as VideoGenerationError).retryable).toBe(false);
      return;
    }
    expect.unreachable('expected assertVideoRequestSupported to throw');
  });
});
