import { getOmniRouteBaseUrl, getOmniRouteApiKey, isUsingOpenRouter } from './client';

export interface WebSearchResult {
  answer: string;
  citations: Array<{ url: string; title?: string }>;
}

/**
 * Real web search via OpenRouter's native `web` plugin (verified live: a
 * plain chat completion request with `plugins: [{ id: "web" }]` returns a
 * grounded, current answer with `annotations[].url_citation` sources - no
 * separate search API/key needed). Only works when OpenRouter is the active
 * gateway; the local/self-hosted OmniRoute fallback has no equivalent.
 */
export async function performWebSearch(query: string): Promise<WebSearchResult> {
  if (!isUsingOpenRouter()) {
    throw new Error('Web search requires the OpenRouter gateway (OPENROUTER_API_KEY), which is not currently active.');
  }

  const response = await fetch(`${getOmniRouteBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getOmniRouteApiKey()}`,
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: query }],
      plugins: [{ id: 'web' }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Web search failed: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  const answer: string | undefined = message?.content;
  if (!answer) {
    throw new Error('Web search response did not include an answer.');
  }

  const citations = (message.annotations || [])
    .filter((a: any) => a.type === 'url_citation')
    .map((a: any) => ({ url: a.url_citation.url, title: a.url_citation.title }));

  return { answer, citations };
}
