/**
 * Backend-specific video generation error handling. The actual mode
 * detection and capability description now live in
 * libs/shared/src/interfaces/video.interface.ts, imported below, so the
 * frontend's pre-submit warning and this backend's pre-provider-call
 * rejection are guaranteed to agree - both call the exact same
 * validateVideoGenerationRequest().
 */
import {
  VideoGenerationMode,
  VideoProviderCapabilities,
  VideoModeInput,
  detectVideoMode,
  getOpenRouterVideoCapabilities,
  validateVideoGenerationRequest,
} from '@chat-monorepo/shared';

export { VideoGenerationMode, VideoProviderCapabilities, VideoModeInput, detectVideoMode, getOpenRouterVideoCapabilities };

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
 * request just fails (and costs) again identically. Delegates the actual
 * verdict to the shared validateVideoGenerationRequest() - this function's
 * only job is turning that verdict into the right VideoGenerationError code.
 */
export function assertVideoRequestSupported(input: VideoModeInput & { capabilities: VideoProviderCapabilities }): void {
  const result = validateVideoGenerationRequest(input);
  if (result.valid) return;

  const code: VideoErrorCode = result.mode === 'unsupported_reference_video' ? 'UNSUPPORTED_REFERENCE_VIDEO' : 'PROVIDER_NOT_CONFIGURED';
  throw new VideoGenerationError(code, result.warning ?? 'This video generation request is not supported.', false);
}
