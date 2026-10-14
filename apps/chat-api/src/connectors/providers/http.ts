import { ProviderHttpError } from '../connector.types';
import { scrubSecrets } from '../redact';

/**
 * The one way a provider adapter talks HTTP. Callers pass a fixed base URL
 * baked into the adapter plus a path built from validated input - never a URL
 * taken from model input (plan §5) - and every call carries the executor's
 * abort signal so a tool's deadline actually cancels the request.
 */
export interface ProviderRequest {
  baseUrl: string;
  path: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | string[] | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
  /** Send `body` as application/x-www-form-urlencoded instead of JSON. */
  form?: boolean;
  signal: AbortSignal;
}

export async function providerFetch<T = unknown>(req: ProviderRequest): Promise<T> {
  const url = new URL(req.path, req.baseUrl);
  // Guard against a path that tries to escape the provider's origin.
  if (url.origin !== new URL(req.baseUrl).origin) {
    throw new ProviderHttpError('Refused a request outside the provider origin.', 0, false);
  }
  for (const [k, v] of Object.entries(req.query ?? {})) {
    if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
    else if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const headers: Record<string, string> = { Accept: 'application/json', ...req.headers };
  let body: string | undefined;
  if (req.body !== undefined) {
    if (req.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(req.body as Record<string, string>).toString();
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(req.body);
    }
  }

  let res: Response;
  try {
    res = await fetch(url, { method: req.method ?? 'GET', headers, body, signal: req.signal });
  } catch (error) {
    if (req.signal.aborted) throw error;
    throw new ProviderHttpError('Could not reach the provider.', 0, true);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    let detail = '';
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.message || parsed?.error_description || parsed?.error?.message || parsed?.error || '';
    } catch {
      detail = '';
    }
    const retryable = res.status === 429 || res.status >= 500;
    const message = scrubSecrets(`Provider returned ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`);
    throw new ProviderHttpError(message, res.status, retryable);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ProviderHttpError('Provider returned a response that was not JSON.', res.status, false);
  }
}

/** Truncates provider text (email bodies, file contents) to a bounded length. */
export function clip(text: string | undefined | null, max: number): { text: string; truncated: boolean } {
  const value = text ?? '';
  return value.length > max ? { text: `${value.slice(0, max)}…`, truncated: true } : { text: value, truncated: false };
}
