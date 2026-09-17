declare const window: Window & { __env?: { apiUrl?: string } };

/**
 * Resolves the chat-api base URL, e.g. "https://chat-api-xxxx-uc.a.run.app",
 * or '' to call the API on the same origin as the client (the case on
 * Vercel, where both are served from one project - see vercel.json).
 * Reads window.__env.apiUrl, populated at build time into
 * src/assets/env.js (see package.json's "build:vercel" script).
 *
 * Uses `??` rather than `||` so an explicitly-set empty string ('', meaning
 * "same origin") is honored rather than treated as unset - only a genuinely
 * missing window.__env (no env.js loaded at all) falls back to localhost.
 */
export function getApiBaseUrl(): string {
  const runtimeUrl = window.__env?.apiUrl;
  return (runtimeUrl ?? 'http://localhost:3000').trim();
}
