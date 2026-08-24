import { test, expect } from '@playwright/test';

/**
 * Research agent E2E coverage.
 *
 * Scope note — most of this feature is verified in vitest rather than here,
 * deliberately:
 *   - planner gating, JSON parsing, source dedup, and every degradation
 *     path: apps/chat-api/src/orchestration/research.spec.ts
 *   - browse_page extraction and its SSRF guards:
 *     apps/chat-api/src/llm/browse-page.spec.ts
 *   - emulator stage emission and ordering:
 *     apps/chat-api/src/emulator/emulator.spec.ts
 *
 * Two things keep that coverage out of the browser. The admin console is
 * reached through in-app state, not a URL — this app runs without the
 * Angular Router (see apps/chat-client/src/app/app.config.ts), so
 * `/admin/emulator` rewrites to `/chat/<thread>` and the emulator UI is
 * unreachable from a signed-out browser. And exercising `/api/chat/stream`
 * against a dev API with no Firestore credentials terminates the API
 * process (an unhandled rejection in the anonymous-trial middleware), which
 * poisons every test after it.
 */

test.describe('Research Agent — admin gate', () => {
  test('the emulator stream stays behind the admin gate', async ({ request }) => {
    // The research stage exposes planner reasoning and gathered evidence,
    // so it must not be reachable without an admin session.
    //
    // Addressed to the API directly rather than through the dev server's
    // /api proxy: the proxy rewrites the status on this streaming endpoint,
    // which would test the proxy rather than the gate.
    const response = await request.post('http://localhost:3000/api/v1/admin/emulator/stream', {
      data: { query: 'nifty outlook today' },
    });

    expect(response.status()).toBe(401);
    expect((await response.json()).error).toBe('Unauthorized');
  });

  test('the admin emulator rejects a non-admin bearer token', async ({ request }) => {
    const response = await request.post('http://localhost:3000/api/v1/admin/emulator/stream', {
      headers: { Authorization: 'Bearer not-a-real-session-token' },
      data: { query: 'nifty outlook today' },
    });

    // Forged/garbage tokens fail signature verification before the role
    // lookup is ever reached.
    expect(response.status()).toBe(401);
  });
});
