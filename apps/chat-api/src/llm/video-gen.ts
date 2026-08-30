import { SelectableModel } from '@chat-monorepo/shared';
import { getOmniRouteBaseUrl, getOmniRouteApiKey, isUsingOpenRouter, VIDEO_GENERATION_MODEL } from './client';
import { GcsUploader } from '../storage/uploader';
import { getOpenRouterVideoCapabilities, assertVideoRequestSupported, VideoGenerationError } from './video-modes';

const POLL_INTERVAL_MS = 5_000;
// Most jobs finish in well under 2 minutes; bounded so a stuck provider job
// can't hang a chat turn indefinitely (mirrors the withTimeout pattern used
// for the research planner in orchestration/research.ts). NOT retried on
// expiry (see the throw below) - the OpenRouter job may still be running
// and billing past this point, and firing a second job on top of it would
// only double the cost for the same stuck request.
const POLL_TIMEOUT_MS = 4 * 60 * 1_000;
const CATALOG_CACHE_TTL_MS = 30 * 60 * 1_000; // matches ModelConfigService's OpenRouter catalog cache

interface VideoJob {
  id: string;
  status: string;
  polling_url?: string;
  unsigned_urls?: string[];
}

interface OpenRouterVideoModel {
  id: string;
  name?: string;
}

/**
 * Fetches JSON and throws a structured VideoGenerationError on a non-2xx
 * response, classifying retryability from the status code: a 5xx or a
 * network-level failure (fetch rejecting before any response, e.g. DNS/
 * connection reset) is transient and safe to retry; a 4xx means the request
 * itself was wrong (bad model, invalid reference, auth) and retrying it
 * unchanged would just fail identically - see "Add Retry Logic Correctly":
 * don't blindly retry invalid requests or capability mismatches.
 */
async function fetchJson<T>(url: string, init: RequestInit, failureLabel: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new VideoGenerationError(
      'PROVIDER_ERROR',
      `${failureLabel}: network error (${(error as Error).message})`,
      true
    );
  }
  if (!response.ok) {
    const body = await response.text();
    throw new VideoGenerationError('PROVIDER_ERROR', `${failureLabel}: ${response.status} ${body}`, response.status >= 500);
  }
  return response.json() as Promise<T>;
}

// Mirrors ModelConfigService.inferProvider's slug-prefix convention.
function inferProvider(id: string): string {
  const prefix = id.split('/')[0] ?? '';
  const known: Record<string, string> = {
    google: 'Google',
    openai: 'OpenAI',
    bytedance: 'ByteDance',
    alibaba: 'Alibaba',
    kuaishou: 'Kuaishou',
    'black-forest-labs': 'Black Forest Labs',
  };
  return known[prefix] || (prefix ? prefix[0].toUpperCase() + prefix.slice(1) : 'Other');
}

let cachedModels: SelectableModel[] | null = null;
let cachedModelsAt = 0;

/**
 * Fetches the live video-model catalog from OpenRouter (GET /videos/models,
 * cached in-memory) rather than hardcoding provider slugs - OpenRouter adds/
 * renames video models often (Sora, Veo, Seedance, Wan, Kling, ...) and an
 * out-of-set slug 400s on generation, so showing whatever OpenRouter
 * currently actually supports is both simpler and safer than guessing.
 * Falls back to the single verified default model (VIDEO_GENERATION_MODEL)
 * if the live fetch fails or OpenRouter isn't the active gateway.
 */
export async function listVideoModels(forceRefresh = false): Promise<SelectableModel[]> {
  const now = Date.now();
  if (!forceRefresh && cachedModels && now - cachedModelsAt < CATALOG_CACHE_TTL_MS) {
    return cachedModels;
  }

  if (!isUsingOpenRouter()) {
    return [{ id: VIDEO_GENERATION_MODEL, name: 'Veo 3.1', provider: 'Google', enabled: true }];
  }

  try {
    const data = await fetchJson<{ data?: OpenRouterVideoModel[] }>(
      `${getOmniRouteBaseUrl()}/videos/models`,
      { headers: { Authorization: `Bearer ${getOmniRouteApiKey()}` } },
      'Failed to fetch video model catalog'
    );

    const models = (data.data ?? []).map(
      (m): SelectableModel => ({
        id: m.id,
        name: m.name || m.id,
        provider: inferProvider(m.id),
        enabled: true,
      })
    );

    if (models.length === 0) throw new Error('OpenRouter returned an empty video model catalog.');

    cachedModels = models;
    cachedModelsAt = now;
    return models;
  } catch (error) {
    console.error('[llm/video-gen] Failed to fetch OpenRouter video model catalog:', error);
    return cachedModels ?? [{ id: VIDEO_GENERATION_MODEL, name: 'Veo 3.1', provider: 'Google', enabled: true }];
  }
}

export interface GenerateVideoOptions {
  /** OpenRouter video model slug (see listVideoModels). Defaults to VIDEO_GENERATION_MODEL. */
  model?: string;
  /**
   * Hosted image URLs (from POST /api/chat/attachments) to guide generation
   * style/subject - OpenRouter's `input_references` field. Not the same as
   * `frame_images` (first/last-frame structural control), which this app
   * doesn't expose - reference-style guidance is the more useful default for
   * "here's what I mean" attachments from a chat composer.
   */
  referenceImageUrls?: string[];
  /**
   * Hosted video URLs the caller wanted used as generation input (e.g. "use
   * this video, keep the same dance"). Never sent to OpenRouter - accepted
   * here only so the capability gate below can detect the intent and reject
   * it with a clear reason, instead of the video silently being dropped and
   * a text-only request going out that can't possibly satisfy what was
   * asked. See video-modes.ts.
   */
  referenceVideoUrls?: string[];
}

/**
 * Generates a real video via OpenRouter's video generation API. Unlike
 * generateImage (one request, one response), this provider's video API is
 * async - submit a job, poll polling_url until it completes, then download
 * the result and upload it to GCS (or return the provider's URL directly
 * when GCS isn't configured, matching generateImage's no-GCS fallback).
 *
 * Every failure path throws VideoGenerationError (code + retryable), never
 * a plain Error, so the route handler can return a structured, actionable
 * response instead of one flat string.
 *
 * OpenRouter-only: video models have no equivalent on the local/self-hosted
 * OmniRoute gateway. Same guard as image-gen.ts, for the same reason - fail
 * with a clear message instead of a confusing raw fetch error.
 *
 * Deliberately does NOT send duration/resolution/aspect_ratio/generate_audio -
 * those are model-specific enums (see listVideoModels) and an out-of-set
 * value 400s, so omitting them lets OpenRouter apply each model's own
 * defaults regardless of which one the caller picked.
 */
export async function generateVideo(prompt: string, options: GenerateVideoOptions = {}): Promise<{ videoUrl: string }> {
  if (!prompt.trim()) {
    throw new VideoGenerationError('MISSING_PROMPT', 'A prompt is required to generate a video.', false);
  }
  if (!isUsingOpenRouter()) {
    throw new VideoGenerationError(
      'PROVIDER_NOT_CONFIGURED',
      'Video generation requires the OpenRouter gateway (OPENROUTER_API_KEY), which is not currently active.',
      false
    );
  }

  const referenceImageUrls = options.referenceImageUrls?.filter(Boolean) ?? [];
  const referenceVideoUrls = options.referenceVideoUrls?.filter(Boolean) ?? [];

  // Capability gate: runs before any OpenRouter call, so a request the
  // provider can't fulfill (video-to-video, character replacement from a
  // source video, ...) never gets submitted - and never costs anything -
  // instead of failing (and billing) after the fact, every time. Same
  // shared validateVideoGenerationRequest() the frontend's pre-submit
  // warning uses (see video-modes.ts), so the two can never disagree.
  assertVideoRequestSupported({ referenceImageUrls, referenceVideoUrls, capabilities: getOpenRouterVideoCapabilities() });

  const baseUrl = getOmniRouteBaseUrl();
  const apiKey = getOmniRouteApiKey();
  const authHeaders = { Authorization: `Bearer ${apiKey}` };

  const job = await fetchJson<VideoJob>(
    `${baseUrl}/videos`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        model: options.model || VIDEO_GENERATION_MODEL,
        prompt,
        ...(referenceImageUrls.length > 0
          ? { input_references: referenceImageUrls.map((url) => ({ type: 'image_url', image_url: { url } })) }
          : {}),
      }),
    },
    'Video generation failed to start'
  );

  const pollUrl = job.polling_url ?? `${baseUrl}/videos/${job.id}`;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let current = job;

  while (current.status !== 'completed') {
    if (current.status === 'failed') {
      throw new VideoGenerationError('PROVIDER_ERROR', 'Video generation job failed.', false);
    }
    if (Date.now() >= deadline) {
      // Not retryable: see POLL_TIMEOUT_MS comment above - the job may
      // still be running and billing on OpenRouter's side past this point.
      throw new VideoGenerationError('TIMEOUT', `Video generation timed out after ${POLL_TIMEOUT_MS}ms.`, false);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    current = await fetchJson<VideoJob>(pollUrl, { headers: authHeaders }, 'Video generation status check failed');
  }

  const providerUrl = current.unsigned_urls?.[0];
  if (!providerUrl) {
    throw new VideoGenerationError('RESULT_MISSING', 'Video generation response did not include a video URL.', false);
  }

  const uploader = new GcsUploader();
  if (!uploader.isReady()) {
    // No GCS bucket configured - return the provider's URL directly rather
    // than a broken/fake storage URL, matching generateImage's no-GCS
    // fallback. Unlike that data URI, this URL comes from the provider's own
    // CDN and may expire - there's no local-storage equivalent to fall back
    // to further than this.
    return { videoUrl: providerUrl };
  }

  let videoResponse: Response;
  try {
    videoResponse = await fetch(providerUrl);
  } catch (error) {
    throw new VideoGenerationError('RESULT_MISSING', `Failed to download generated video: ${(error as Error).message}`, true);
  }
  if (!videoResponse.ok) {
    throw new VideoGenerationError('RESULT_MISSING', `Failed to download generated video: ${videoResponse.status}`, videoResponse.status >= 500);
  }
  const buffer = Buffer.from(await videoResponse.arrayBuffer());

  try {
    const videoUrl = await uploader.uploadFile(buffer, `generated-${Date.now()}.mp4`, 'video/mp4');
    return { videoUrl };
  } catch (error) {
    // The video WAS generated (and billed) successfully at this point - a
    // GCS upload failure is our own storage layer, not the provider, so it
    // gets its own code rather than being folded into PROVIDER_ERROR.
    throw new VideoGenerationError('STORAGE_ERROR', `Video generated but failed to store: ${(error as Error).message}`, true);
  }
}
