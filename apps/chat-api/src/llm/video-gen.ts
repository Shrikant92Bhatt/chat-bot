import { SelectableModel } from '@chat-monorepo/shared';
import { getOmniRouteBaseUrl, getOmniRouteApiKey, isUsingOpenRouter, VIDEO_GENERATION_MODEL } from './client';
import { GcsUploader } from '../storage/uploader';

const POLL_INTERVAL_MS = 5_000;
// Most jobs finish in well under 2 minutes; bounded so a stuck provider job
// can't hang a chat turn indefinitely (mirrors the withTimeout pattern used
// for the research planner in orchestration/research.ts).
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

async function fetchJson<T>(url: string, init: RequestInit, failureLabel: string): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${failureLabel}: ${response.status} ${await response.text()}`);
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
}

/**
 * Generates a real video via OpenRouter's video generation API. Unlike
 * generateImage (one request, one response), this provider's video API is
 * async - submit a job, poll polling_url until it completes, then download
 * the result and upload it to GCS (or return the provider's URL directly
 * when GCS isn't configured, matching generateImage's no-GCS fallback).
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
  if (!isUsingOpenRouter()) {
    throw new Error('Video generation requires the OpenRouter gateway (OPENROUTER_API_KEY), which is not currently active.');
  }

  const baseUrl = getOmniRouteBaseUrl();
  const apiKey = getOmniRouteApiKey();
  const authHeaders = { Authorization: `Bearer ${apiKey}` };
  const referenceImageUrls = options.referenceImageUrls?.filter(Boolean) ?? [];

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
      throw new Error('Video generation job failed.');
    }
    if (Date.now() >= deadline) {
      throw new Error(`Video generation timed out after ${POLL_TIMEOUT_MS}ms.`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    current = await fetchJson<VideoJob>(pollUrl, { headers: authHeaders }, 'Video generation status check failed');
  }

  const providerUrl = current.unsigned_urls?.[0];
  if (!providerUrl) {
    throw new Error('Video generation response did not include a video URL.');
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

  const videoResponse = await fetch(providerUrl);
  if (!videoResponse.ok) {
    throw new Error(`Failed to download generated video: ${videoResponse.status}`);
  }
  const buffer = Buffer.from(await videoResponse.arrayBuffer());
  const videoUrl = await uploader.uploadFile(buffer, `generated-${Date.now()}.mp4`, 'video/mp4');
  return { videoUrl };
}
