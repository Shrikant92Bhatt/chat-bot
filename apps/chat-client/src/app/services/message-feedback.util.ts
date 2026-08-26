import { MessageFeedbackRating, ThreadFeedbackMap } from '@chat-monorepo/shared';

/**
 * Pure helpers behind the thumbs up/down buttons' click behavior - kept
 * outside ChatService (and free of Angular/fetch) so the toggle/merge logic
 * can be unit tested directly, without instantiating the service or its
 * dependencies (AuthService, Location, ...).
 */

/**
 * What rating to SEND to the backend for a click on `clicked`, given the
 * message's currently-displayed rating. Clicking the already-selected thumb
 * clears it (toggle off, `null`); clicking the other thumb - or clicking
 * with nothing currently selected - sets that rating.
 */
export function nextRatingOnClick(
  current: MessageFeedbackRating | null | undefined,
  clicked: MessageFeedbackRating
): MessageFeedbackRating | null {
  return current === clicked ? null : clicked;
}

/**
 * Applies a rating to a feedback map immutably. `rating: null` removes the
 * entry entirely rather than storing an explicit null, so the map's own
 * keys are exactly "the messages that have a rating" - callers never need a
 * second check to tell "rated null" apart from "never rated". Returns the
 * same reference when nothing actually changes, so callers can cheaply
 * skip a signal update.
 */
export function applyRating(
  feedback: ThreadFeedbackMap,
  messageId: string,
  rating: MessageFeedbackRating | null
): ThreadFeedbackMap {
  if (rating === null) {
    if (!(messageId in feedback)) return feedback;
    const next = { ...feedback };
    delete next[messageId];
    return next;
  }
  if (feedback[messageId] === rating) return feedback;
  return { ...feedback, [messageId]: rating };
}
