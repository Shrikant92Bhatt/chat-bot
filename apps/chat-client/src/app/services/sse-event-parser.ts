/**
 * Buffers raw SSE stream text and extracts complete `data: ...` event
 * payloads.
 *
 * The backend writes one `data: <json>\n\n` frame per event, but a fetch
 * `ReadableStream`'s `reader.read()` hands back arbitrary byte chunks with
 * no relationship to those frame boundaries - a single event's JSON, or
 * even the blank-line `\n\n` separator itself, can land split across two
 * `read()` calls. Parsing each chunk in isolation (splitting on `\n\n`
 * per-chunk, independently of every other chunk) silently drops or
 * mis-parses any event that happens to straddle a chunk boundary.
 *
 * This class instead accumulates a persistent buffer across calls to
 * `push()` and only ever emits an event once it has actually seen the
 * `\n\n` that terminates it, holding back everything after the last
 * complete boundary for the next call. Mirrors the buffering style of
 * `UiBlockStreamFilter` (apps/chat-api/src/orchestration/ui-stream-filter.ts)
 * - no framework dependencies, just string buffering logic.
 */
export class SseEventParser {
  private buffer = '';

  /**
   * Feed the next decoded chunk of stream text (already run through
   * `TextDecoder.decode(value, { stream: true })` by the caller, so partial
   * multi-byte UTF-8 sequences are already handled upstream). Returns every
   * complete event's payload string - the JSON body only, with the
   * `data: ` prefix stripped - now available. A block with no `data:` line
   * (a bare SSE comment/heartbeat, e.g. `: ping`, or a blank keep-alive) is
   * consumed from the buffer but produces no entry in the returned array.
   * Anything after the last `\n\n` boundary seen so far stays buffered for
   * the next call.
   */
  push(rawChunkText: string): string[] {
    this.buffer += rawChunkText;

    const payloads: string[] = [];
    let boundary = this.buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const rawEvent = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);

      const payload = SseEventParser.extractPayload(rawEvent);
      if (payload !== null) payloads.push(payload);

      boundary = this.buffer.indexOf('\n\n');
    }

    return payloads;
  }

  /**
   * Call once the underlying stream has ended. Returns the payload string
   * of whatever event was left in the buffer with no trailing `\n\n` ever
   * arriving to terminate it (e.g. the server closes the connection right
   * after its last event with no final blank line), or `null` if nothing
   * usable was left. Clears the buffer either way.
   */
  flush(): string | null {
    const payload = SseEventParser.extractPayload(this.buffer);
    this.buffer = '';
    return payload;
  }

  /** Pulls a `data: ` line's payload out of one raw (un-split) SSE event block. */
  private static extractPayload(rawEvent: string): string | null {
    for (const line of rawEvent.split('\n')) {
      if (line.startsWith('data: ')) return line.slice(6);
      if (line.startsWith('data:')) return line.slice(5).trimStart();
    }
    return null;
  }
}
