import { describe, it, expect, vi } from 'vitest';

// This codebase has no established Firestore-mocking pattern yet (no
// service test touches Firestore directly before this) - db/firestore.ts
// is swapped for an isolated in-memory fake (testing/fake-firestore.ts) so
// MessageFeedbackService can be exercised without a real Firestore emulator.
vi.mock('../db/firestore', async () => {
  const { createFakeFirestore } = await import('../testing/fake-firestore');
  return { firestore: createFakeFirestore() };
});

import { MessageFeedbackService } from './message-feedback.service';

describe('MessageFeedbackService', () => {
  it('writes a rating and reads it back keyed by messageId', async () => {
    await MessageFeedbackService.setRating('user-1', 'thread-1', 'msg-1', 'up');
    const feedback = await MessageFeedbackService.getFeedbackForThread('user-1', 'thread-1');
    expect(feedback).toEqual({ 'msg-1': 'up' });
  });

  it('overwrites the same record when the rating changes, rather than accumulating duplicates', async () => {
    await MessageFeedbackService.setRating('user-1', 'thread-2', 'msg-2', 'up');
    await MessageFeedbackService.setRating('user-1', 'thread-2', 'msg-2', 'down');
    const feedback = await MessageFeedbackService.getFeedbackForThread('user-1', 'thread-2');
    expect(feedback).toEqual({ 'msg-2': 'down' });
  });

  it('clears a rating when rating is null (re-clicking the selected thumb toggles it off)', async () => {
    await MessageFeedbackService.setRating('user-1', 'thread-3', 'msg-3', 'down');
    await MessageFeedbackService.setRating('user-1', 'thread-3', 'msg-3', null);
    const feedback = await MessageFeedbackService.getFeedbackForThread('user-1', 'thread-3');
    expect(feedback).toEqual({});
  });

  it('scopes reads to the requesting user even if another user rated the same thread id', async () => {
    await MessageFeedbackService.setRating('user-a', 'thread-4', 'msg-4', 'up');
    await MessageFeedbackService.setRating('user-b', 'thread-4', 'msg-4', 'down');

    expect(await MessageFeedbackService.getFeedbackForThread('user-a', 'thread-4')).toEqual({ 'msg-4': 'up' });
    expect(await MessageFeedbackService.getFeedbackForThread('user-b', 'thread-4')).toEqual({ 'msg-4': 'down' });
  });

  it('keeps ratings for different messages in the same thread independent', async () => {
    await MessageFeedbackService.setRating('user-1', 'thread-5', 'msg-5a', 'up');
    await MessageFeedbackService.setRating('user-1', 'thread-5', 'msg-5b', 'down');

    const feedback = await MessageFeedbackService.getFeedbackForThread('user-1', 'thread-5');
    expect(feedback).toEqual({ 'msg-5a': 'up', 'msg-5b': 'down' });
  });
});
