import { getOmniRouteBaseUrl, getOmniRouteApiKey, isUsingOpenRouter, VIDEO_GENERATION_MODEL } from './client';
import { GcsUploader } from '../storage/uploader';

const POLL_INTERVAL_MS = 5_000;
// Most jobs finish in well under 2 minutes; bounded so a stuck provider job
// can't hang a chat turn indefinitely (mirrors the withTimeout pattern used
// for the research planner in orchestration/research.ts).
const POLL_TIMEOUT_MS = 4 * 60 * 1_000;

interface VideoJob {
  id: string;
  status: string;
  polling_url?: string;
  unsigned_urls?: string[];
}

async function fetchJson<T>(url: string, init: RequestInit, failureLabel: string): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${failureLabel}: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

/**
 * Generates a real video via OpenRouter's video generation API. Unlike
 * generateImage (one request, one response), this provider's video API is
 * async - submit a job, poll polling_url until it completes, then download
 * the result and upload it to GCS (or return the provider's URL directly
 * when GCS isn't configured, matching generateImage's no-GCS fallback).
 *
 * OpenRouter-only: VIDEO_GENERATION_MODEL has no equivalent on the local/
 * self-hosted OmniRoute gateway. Same guard as image-gen.ts, for the same
 * reason - fail with a clear message instead of a confusing raw fetch error.
 */
export async function generateVideo(prompt: string): Promise<{ videoUrl: string }> {
  if (!isUsingOpenRouter()) {
    throw new Error('Video generation requires the OpenRouter gateway (OPENROUTER_API_KEY), which is not currently active.');
  }

  const baseUrl = getOmniRouteBaseUrl();
  const apiKey = getOmniRouteApiKey();
  const authHeaders = { Authorization: `Bearer ${apiKey}` };

  const job = await fetchJson<VideoJob>(
    `${baseUrl}/videos`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        model: VIDEO_GENERATION_MODEL,
        prompt,
        duration: 6,
        resolution: '720p',
        aspect_ratio: '16:9',
        // Off by default: roughly doubles cost per generation for a
        // capability most chat requests won't need.
        generate_audio: false,
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
