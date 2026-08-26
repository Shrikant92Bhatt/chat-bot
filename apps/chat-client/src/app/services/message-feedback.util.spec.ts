import { describe, it, expect } from 'vitest';
import { applyRating, nextRatingOnClick } from './message-feedback.util';

describe('nextRatingOnClick', () => {
  it('sets the rating when nothing is currently selected', () => {
    expect(nextRatingOnClick(null, 'up')).toBe('up');
    expect(nextRatingOnClick(undefined, 'down')).toBe('down');
  });

  it('switches the rating when clicking the other thumb', () => {
    expect(nextRatingOnClick('up', 'down')).toBe('down');
    expect(nextRatingOnClick('down', 'up')).toBe('up');
  });

  it('clears the rating when clicking the already-selected thumb (toggle off)', () => {
    expect(nextRatingOnClick('up', 'up')).toBeNull();
    expect(nextRatingOnClick('down', 'down')).toBeNull();
  });
});

describe('applyRating', () => {
  it('adds a new rating for a message with none yet', () => {
    expect(applyRating({}, 'msg-1', 'up')).toEqual({ 'msg-1': 'up' });
  });

  it('overwrites an existing rating for the same message rather than duplicating it', () => {
    expect(applyRating({ 'msg-1': 'up' }, 'msg-1', 'down')).toEqual({ 'msg-1': 'down' });
  });

  it('removes the key entirely when rating is null, instead of storing an explicit null', () => {
    const result = applyRating({ 'msg-1': 'up', 'msg-2': 'down' }, 'msg-1', null);
    expect(result).toEqual({ 'msg-2': 'down' });
    expect('msg-1' in result).toBe(false);
  });

  it('leaves other messages in the map untouched', () => {
    const result = applyRating({ 'msg-1': 'up', 'msg-2': 'down' }, 'msg-1', 'down');
    expect(result).toEqual({ 'msg-1': 'down', 'msg-2': 'down' });
  });

  it('returns the same reference when clearing a message that was never rated (no-op)', () => {
    const original = { 'msg-2': 'down' as const };
    expect(applyRating(original, 'msg-1', null)).toBe(original);
  });

  it('returns the same reference when re-applying the rating a message already has (no-op)', () => {
    const original = { 'msg-1': 'up' as const };
    expect(applyRating(original, 'msg-1', 'up')).toBe(original);
  });
});
