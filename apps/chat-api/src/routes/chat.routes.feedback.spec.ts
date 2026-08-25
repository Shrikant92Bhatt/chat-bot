import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express, { Express } from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

// Same fake-Firestore approach as message-feedback.service.spec.ts - this
// intercepts every service's `../db/firestore` import (ThreadService,
// MessageFeedbackService, etc. all resolve to the same physical file), so
// the route can be exercised end-to-end (real Express app, real JWT auth
// middleware) without touching a real Firestore project.
vi.mock('../db/firestore', async () => {
  const { createFakeFirestore } = await import('../testing/fake-firestore');
  return { firestore: createFakeFirestore() };
});

process.env.APP_SESSION_SECRET = process.env.APP_SESSION_SECRET || 'test-secret-for-feedback-route-spec';

const { mintAppSessionToken } = await import('../middleware/auth.middleware');
const chatRoutes = (await import('./chat.routes')).default;
const { firestore } = await import('../db/firestore');

/** Seeds a thread doc directly, mirroring ThreadService's own Firestore
 *  layout (`users/{uid}/threads/{threadId}`) - this is what "the caller
 *  owns this thread" means server-side (see ThreadService.getThread). */
async function seedThread(uid: string, threadId: string): Promise<void> {
  await firestore
    .collection('users')
    .doc(uid)
    .collection('threads')
    .doc(threadId)
    .set({ id: threadId, title: 'Test thread', messages: [{ id: 'm', role: 'user', content: 'hi', timestamp: 0 }] });
}

function authHeader(uid: string): Record<string, string> {
  return { Authorization: `Bearer ${mintAppSessionToken({ uid })}` };
}

describe('POST /api/chat/feedback and GET /api/chat/threads/:threadId/feedback', () => {
  let app: Express;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use('/api/chat', chatRoutes);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/api/chat`;
  });

  afterAll(() => {
    server.close();
  });

  it('rejects rating a thread the caller does not own with 404 (not 403)', async () => {
    await seedThread('owner-uid', 'thread-owned-by-someone-else');

    const res = await fetch(`${baseUrl}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader('attacker-uid') },
      body: JSON.stringify({ threadId: 'thread-owned-by-someone-else', messageId: 'msg-1', rating: 'up' }),
    });

    expect(res.status).toBe(404);
  });

  it('writes a rating for a thread the caller does own', async () => {
    await seedThread('user-1', 'thread-1');

    const res = await fetch(`${baseUrl}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader('user-1') },
      body: JSON.stringify({ threadId: 'thread-1', messageId: 'msg-1', rating: 'up' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, rating: 'up' });

    const getRes = await fetch(`${baseUrl}/threads/thread-1/feedback`, { headers: authHeader('user-1') });
    const getBody = await getRes.json();
    expect(getBody).toEqual({ feedback: { 'msg-1': 'up' } });
  });

  it('toggles a rating off when the client re-POSTs rating: null', async () => {
    await seedThread('user-2', 'thread-2');

    await fetch(`${baseUrl}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader('user-2') },
      body: JSON.stringify({ threadId: 'thread-2', messageId: 'msg-2', rating: 'down' }),
    });

    const clearRes = await fetch(`${baseUrl}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader('user-2') },
      body: JSON.stringify({ threadId: 'thread-2', messageId: 'msg-2', rating: null }),
    });
    const clearBody = await clearRes.json();
    expect(clearRes.status).toBe(200);
    expect(clearBody).toEqual({ success: true, rating: null });

    const getRes = await fetch(`${baseUrl}/threads/thread-2/feedback`, { headers: authHeader('user-2') });
    expect(await getRes.json()).toEqual({ feedback: {} });
  });

  it('rejects an unauthenticated request', async () => {
    const res = await fetch(`${baseUrl}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: 'thread-1', messageId: 'msg-1', rating: 'up' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an invalid rating value', async () => {
    await seedThread('user-3', 'thread-3');
    const res = await fetch(`${baseUrl}/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader('user-3') },
      body: JSON.stringify({ threadId: 'thread-3', messageId: 'msg-1', rating: 'sideways' }),
    });
    expect(res.status).toBe(400);
  });

  it('GET returns an empty map (not an error) for a thread that has not been persisted yet', async () => {
    const res = await fetch(`${baseUrl}/threads/never-saved-thread/feedback`, { headers: authHeader('user-1') });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ feedback: {} });
  });
});
