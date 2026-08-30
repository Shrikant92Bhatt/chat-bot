import { AttachmentKind } from './chat.interface';

/**
 * Canonical MIME-to-kind classification, shared verbatim between the
 * frontend (staging an attachment before upload) and the backend
 * (POST /api/chat/attachments, after upload) so the two can never disagree
 * about what a file is. Previously each side kept its own independent list
 * (ALLOWED_IMAGE_TYPES/ALLOWED_VIDEO_TYPES client-side, ATTACHMENT_MIME_KIND
 * server-side) that happened to match but had no mechanism keeping them in
 * sync - a real drift risk, even though both were already MIME-based (never
 * filename-based) and no actual mismatch could be found in either list as
 * written. One source of truth removes that risk entirely rather than
 * trusting two lists to stay identical by convention.
 */
export const MIME_TO_ATTACHMENT_KIND: Readonly<Record<string, AttachmentKind>> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/heic': 'image',
  'image/heif': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
};

/**
 * Classifies a MIME type into an AttachmentKind, or null if unrecognized.
 * Always the actual MIME type, never a filename/extension guess - matches
 * both the browser's File.type and multer's file.mimetype, which are both
 * sniffed from file content/headers, not the filename.
 */
export function normalizeAttachmentKind(mimeType: string): AttachmentKind | null {
  return MIME_TO_ATTACHMENT_KIND[mimeType] ?? null;
}

/**
 * Normalized shape for a media file after classification, before or after
 * upload. ChatAttachment (chat.interface.ts) is this same shape plus
 * upload-specific fields (url, contentType, fileName) once hosted - this
 * lighter type is for describing a File/attachment generically wherever
 * upload state doesn't matter yet.
 */
export interface NormalizedMediaAsset {
  id: string;
  type: AttachmentKind;
  mimeType: string;
  url?: string;
  size?: number;
  duration?: number;
}

export type VideoGenerationMode =
  | 'text_to_video'
  | 'image_to_video'
  /**
   * Detected but not implementable with any currently configured provider -
   * an existing video was supplied as generation input (video-to-video
   * editing, character replacement in an existing video, motion/style
   * transfer from a source video, ...). Kept as its own mode rather than
   * silently collapsing into text_to_video so callers can reject it with a
   * clear reason instead of quietly generating something unrelated to what
   * was asked.
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
 * do. This is a fixed, verified property of OpenRouter's video API shape -
 * its documented parameters are `frame_images`/`input_references`, both
 * image-only; no parameter anywhere accepts a video file as input, for any
 * model. That's an API-level fact (confirmed against OpenRouter's own
 * documentation), independent of which specific model is selected - so
 * referenceVideo stays false regardless of model choice.
 *
 * OpenRouter's per-model catalog (GET /videos/models, see
 * apps/chat-api/src/llm/video-gen.ts listVideoModels()) does expose some
 * per-model capability fields (supported_frame_images, generate_audio,
 * seed, ...), but does NOT document a per-model boolean for input_references
 * support specifically - so this stays a single provider-level capability
 * description rather than fabricating a per-model flag that isn't actually
 * published anywhere. If OpenRouter's docs ever publish that, this is the
 * one place to wire it in.
 *
 * If a second video provider is ever added, this becomes a per-provider
 * lookup - deferred until one actually exists, rather than building a
 * provider registry for a single provider.
 */
export interface VideoProviderCapabilities {
  textToVideo: boolean;
  imageToVideo: boolean;
  referenceVideo: boolean;
}

export function getOpenRouterVideoCapabilities(): VideoProviderCapabilities {
  return { textToVideo: true, imageToVideo: true, referenceVideo: false };
}

export interface VideoGenerationValidationResult {
  valid: boolean;
  mode: VideoGenerationMode;
  /** Present only when valid is false - the specific, actionable reason. */
  warning?: string;
}

/**
 * Capability-driven validation: whether THIS request (given what's actually
 * attached) can be satisfied by THIS provider's capabilities - never a
 * blanket "video mode -> reject all video attachments" rule. Used
 * identically by the backend (to reject before ever calling OpenRouter) and
 * the frontend (to warn before the user even submits), so the two can never
 * show different verdicts for the same attachments.
 *
 * modelName is optional and only used to phrase the warning - it does not
 * affect the verdict itself, since OpenRouter's reference-video limitation
 * is provider-wide, not model-specific (see getOpenRouterVideoCapabilities).
 */
export function validateVideoGenerationRequest(
  input: VideoModeInput & { capabilities: VideoProviderCapabilities; modelName?: string }
): VideoGenerationValidationResult {
  const mode = detectVideoMode(input);
  const model = input.modelName ? ` (${input.modelName})` : '';

  if (mode === 'unsupported_reference_video' && !input.capabilities.referenceVideo) {
    return {
      valid: false,
      mode,
      warning:
        `Your selected video model${model} doesn't support reference-video input - only images can guide ` +
        'generation, not video files. Try describing the video from scratch, or attach a reference image instead of a video.',
    };
  }
  if (mode === 'image_to_video' && !input.capabilities.imageToVideo) {
    return { valid: false, mode, warning: `Your selected video model${model} doesn't support image-guided generation.` };
  }
  if (mode === 'text_to_video' && !input.capabilities.textToVideo) {
    return { valid: false, mode, warning: `Your selected video model${model} doesn't support text-to-video generation.` };
  }
  return { valid: true, mode };
}
