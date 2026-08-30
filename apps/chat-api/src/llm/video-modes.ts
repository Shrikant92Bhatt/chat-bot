/**
 * Video generation mode detection and provider-capability gating.
 *
 * Root cause this exists to fix: a request like "use this reference video,
 * keep the same dance, replace the baby with the person from this image" was
 * failing every time (and still incurring OpenRouter cost on the attempt)
 * because it asks for video-to-video / character-replacement, which is not
 * a capability OpenRouter's video API exposes at all - only image inputs
 * (`frame_images`/`input_references`), never a video file. Previously that
 * intent was silently dropped (video attachments never reached the backend)
 * and the request still got submitted with just the text prompt, which
 * OpenRouter would accept, bill for, and generate something unrelated to what
 * was actually asked - repeatedly. See ARCHITECTURE note in video-gen.ts for
 * where this plugs in: assertVideoRequestSupported() runs BEFORE any
 * OpenRouter call, so an unsupported request never reaches (or costs
 * against) the provider at all.
 */

export type VideoGenerationMode =
  | 'text_to_video'
  | 'image_to_video'
  /**
   * Detected but not implementable with any currently configured provider -
   * the caller attached (or the request otherwise references) an existing
   * video as generation input. Kept as its own mode rather than silently
   * collapsing into text_to_video specifically so the capability gate below
   * can reject it with a clear reason instead of quietly generating
   * something unrelated to what was asked.
   */
  | 'unsupported_reference_video';

export interface VideoModeInput {
  referenceImageUrls?: string[];
  /** Present only to be DETECTED and rejected - see unsupported_reference_video above. */
  referenceVideoUrls?: string[];
}

export function detectVideoMode(input: VideoModeInput): VideoGenerationMode {
  if (input.referenceVideoUrls && input.referenceVideoUrls.length > 0) return 'unsupported_reference_video';
  if (input.referenceImageUrls && input.referenceImageUrls.length > 0) return 'image_to_video';
  return 'text_to_video';
}

/**
 * What the currently configured video provider (OpenRouter) can actually
 * do, per its documented API (frame_images/input_references are image-only;
 * no parameter anywhere accepts a video file as input). This is a fixed
 * property of OpenRouter's video API shape, not something that varies by
 * model - the live per-model catalog (listVideoModels() in video-gen.ts)
 * varies duration/resolution/audio support, not this.
 *
 * If a second video provider is ever added, this becomes a per-provider
 * lookup (see VideoProvider note below) - deferred until one actually
 * exists, rather than building a provider registry for a single provider.
 */
export interface VideoProviderCapabilities {
  textToVideo: boolean;
  imageToVideo: boolean;
  referenceVideo: boolean;
}

export function getOpenRouterVideoCapabilities(): VideoProviderCapabilities {
  return { textToVideo: true, imageToVideo: true, referenceVideo: false };
}

export type VideoErrorCode =
  | 'MISSING_PROMPT'
  | 'UNSUPPORTED_REFERENCE_VIDEO'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'RESULT_MISSING'
  | 'STORAGE_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * Thrown instead of a plain Error anywhere in the video generation path so
 * the route handler can return a structured, actionable response (code +
 * retryable) rather than one flat string - see chat.routes.ts POST
 * /generate-video.
 */
export class VideoGenerationError extends Error {
  constructor(public readonly code: VideoErrorCode, message: string, public readonly retryable: boolean) {
    super(message);
    this.name = 'VideoGenerationError';
  }
}

/**
 * The capability gate: throws before any provider call if the request needs
 * something OpenRouter can't do. Never retryable - retrying an unsupported
 * request just fails (and costs) again identically.
 */
export function assertVideoRequestSupported(mode: VideoGenerationMode, capabilities: VideoProviderCapabilities): void {
  if (mode === 'unsupported_reference_video' && !capabilities.referenceVideo) {
    throw new VideoGenerationError(
      'UNSUPPORTED_REFERENCE_VIDEO',
      'Using an existing video as a reference (video-to-video editing, character replacement, motion/style transfer from a video) ' +
        "isn't supported by the configured video provider (OpenRouter) - only images can guide generation, not video files. " +
        'Try describing the video from scratch, or attach a reference image instead of a video.',
      false
    );
  }
  if (mode === 'image_to_video' && !capabilities.imageToVideo) {
    throw new VideoGenerationError('UNSUPPORTED_REFERENCE_VIDEO', 'Image-guided video generation is not supported right now.', false);
  }
  if (mode === 'text_to_video' && !capabilities.textToVideo) {
    throw new VideoGenerationError('PROVIDER_NOT_CONFIGURED', 'Text-to-video generation is not supported right now.', false);
  }
}
