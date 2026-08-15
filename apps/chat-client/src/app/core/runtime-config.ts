declare const window: Window & { __env?: { apiUrl?: string } };

/**
 * Resolves the chat-api base URL (e.g. "https://chat-api-xxxx-uc.a.run.app").
 * Reads window.__env.apiUrl, populated at container startup from the API_URL
 * env var (see docker-entrypoint.sh), falling back to localhost for `ng serve`.
 */
export function getApiBaseUrl(): string {
  const runtimeUrl = window.__env?.apiUrl?.trim();
  return runtimeUrl || 'http://localhost:3000';
}
