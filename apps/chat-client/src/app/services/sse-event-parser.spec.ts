import { describe, it, expect } from 'vitest';
import { SseEventParser } from './sse-event-parser';

describe('SseEventParser', () => {
  it('returns one complete event when it arrives whole in a single chunk', () => {
    const parser = new SseEventParser();
    const payloads = parser.push('data: {"chunk":"hello"}\n\n');
    expect(payloads).toEqual(['{"chunk":"hello"}']);
  });

  it('returns every complete event when multiple arrive in one chunk', () => {
    const parser = new SseEventParser();
    const payloads = parser.push('data: {"chunk":"a"}\n\ndata: {"chunk":"b"}\n\ndata: {"chunk":"c"}\n\n');
    expect(payloads).toEqual(['{"chunk":"a"}', '{"chunk":"b"}', '{"chunk":"c"}']);
  });

  it('recovers an event whose JSON payload is split across two chunks', () => {
    const parser = new SseEventParser();
    const full = 'data: {"research":{"type":"research_sources","sources":[{"title":"a very long title","url":"https://example.com/x"}]}}\n\n';
    const splitAt = 40;
    const first = full.slice(0, splitAt);
    const second = full.slice(splitAt);

    expect(parser.push(first)).toEqual([]);
    const payloads = parser.push(second);

    expect(payloads).toHaveLength(1);
    expect(JSON.parse(payloads[0])).toEqual({
      research: {
        type: 'research_sources',
        sources: [{ title: 'a very long title', url: 'https://example.com/x' }],
      },
    });
  });

  it('recovers an event whose terminating \\n\\n boundary itself is split across two chunks', () => {
    const parser = new SseEventParser();

    // Split right in between the two newline characters that make up the boundary.
    expect(parser.push('data: {"chunk":"x"}\n')).toEqual([]);
    const payloads = parser.push('\ndata: {"chunk":"y"}\n\n');

    expect(payloads).toEqual(['{"chunk":"x"}', '{"chunk":"y"}']);
  });

  it('returns a trailing incomplete event from flush() when the stream ends with no closing boundary', () => {
    const parser = new SseEventParser();

    expect(parser.push('data: {"done":true,"suggestions":["a","b"]}')).toEqual([]);
    expect(parser.flush()).toBe('{"done":true,"suggestions":["a","b"]}');
    // The buffer is cleared after flush - nothing left to flush again.
    expect(parser.flush()).toBeNull();
  });

  it('does not break the buffer on an SSE comment/heartbeat line with no data: field', () => {
    const parser = new SseEventParser();

    // A bare comment/heartbeat block produces no payload...
    expect(parser.push(': heartbeat\n\n')).toEqual([]);
    // ...but the parser keeps working correctly for every event around it.
    const payloads = parser.push('data: {"chunk":"after-heartbeat"}\n\n');
    expect(payloads).toEqual(['{"chunk":"after-heartbeat"}']);
  });

  it('handles a heartbeat interleaved with a JSON payload split across chunks', () => {
    const parser = new SseEventParser();

    expect(parser.push('data: {"chunk":"one"}\n\n: ping\n\ndata: {"chu')).toEqual(['{"chunk":"one"}']);
    expect(parser.push('nk":"two"}\n\n')).toEqual(['{"chunk":"two"}']);
  });

  it('keeps buffering across many small pushes with nothing complete yet', () => {
    const parser = new SseEventParser();
    const full = 'data: {"chunk":"reassembled from many tiny pieces"}\n\n';

    let lastResult: string[] = [];
    for (const char of full) {
      lastResult = parser.push(char);
    }

    expect(lastResult).toEqual(['{"chunk":"reassembled from many tiny pieces"}']);
  });

  it('flush() returns null when the buffer is empty', () => {
    const parser = new SseEventParser();
    parser.push('data: {"chunk":"x"}\n\n');
    expect(parser.flush()).toBeNull();
  });
});
