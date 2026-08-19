declare const window: Window & { __env?: { apiUrl?: string } };

/**
 * Resolves the chat-api base URL. Reads window.__env.apiUrl, populated at
 * container startup from the API_URL env var (docker-entrypoint.sh, shared
 * with Dockerfile.client), falling back to localhost for `nx serve`.
 *
 * Intentionally identical to apps/chat-client/src/app/core/runtime-config.ts -
 * see admin-auth.service.ts for why this app duplicates rather than shares.
 */
export function getApiBaseUrl(): string {
  const runtimeUrl = window.__env?.apiUrl?.trim();
  return runtimeUrl || 'http://localhost:3000';
}
