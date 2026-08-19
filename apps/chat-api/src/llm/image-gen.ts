import { getOmniRouteBaseUrl, getOmniRouteApiKey, isUsingOpenRouter, IMAGE_GENERATION_MODEL } from './client';
import { GcsUploader } from '../storage/uploader';

/**
 * Generates a real image via OpenRouter's image-output models (request
 * `modalities: ["image", "text"]`; the model returns a base64 data URL in
 * `message.images[0].image_url.url` — verified against the live API, not
 * guessed). Uploads to GCS when configured; otherwise returns the data URI
 * directly so the browser can still render a real image.
 *
 * OpenRouter-only: IMAGE_GENERATION_MODEL is an OpenRouter slug with no
 * equivalent on the local/self-hosted OmniRoute gateway. Without this guard,
 * a deployment with OPENROUTER_API_KEY unset would silently fire this
 * request at the OmniRoute gateway instead (see getActiveGateway in
 * client.ts) and fail with a confusing raw fetch/parse error - this makes
 * the actual cause explicit instead.
 */
export async function generateImage(prompt: string): Promise<{ imageUrl: string }> {
  if (!isUsingOpenRouter()) {
    throw new Error('Image generation requires the OpenRouter gateway (OPENROUTER_API_KEY), which is not currently active.');
  }

  const response = await fetch(`${getOmniRouteBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getOmniRouteApiKey()}`,
    },
    body: JSON.stringify({
      model: IMAGE_GENERATION_MODEL,
      messages: [{ role: 'user', content: prompt }],
      modalities: ['image', 'text'],
    }),
  });

  if (!response.ok) {
    throw new Error(`Image generation failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const dataUrl: string | undefined = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    throw new Error('Image generation response did not include an image.');
  }

  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) {
    throw new Error('Unexpected image data URL format.');
  }
  const [, mimeType, base64Data] = match;
  const buffer = Buffer.from(base64Data, 'base64');
  const extension = mimeType.split('/')[1] || 'png';

  const uploader = new GcsUploader();
  if (uploader.isReady()) {
    const url = await uploader.uploadImage(buffer, `generated-${Date.now()}.${extension}`, mimeType);
    return { imageUrl: url };
  }

  // No GCS bucket configured - return the real image inline as a data URI
  // rather than a broken/fake storage URL. The browser renders this directly.
  return { imageUrl: dataUrl };
}
