/**
 * Withholds a trailing ```ui fenced block from the live SSE token stream.
 *
 * The model streams its reply token by token and those tokens are forwarded
 * to the client as they arrive (see graph.ts). If the model appends a
 * ```ui {...}``` block at the end (per ui_orchestrator:v1), that raw JSON
 * would otherwise flash on screen for a moment before anyone gets a chance
 * to parse and strip it. This filter buffers just enough of the stream to
 * detect the opening fence before it commits text as "safe to display", and
 * once seen, captures everything after it silently instead of forwarding it.
 */
const UI_FENCE_OPEN = '```ui';

export class UiBlockStreamFilter {
  private pending = '';
  private capturing = false;
  private captured = '';

  /** Feed the next streamed token. Returns the portion now safe to display. */
  push(token: string): string {
    if (this.capturing) {
      this.captured += token;
      return '';
    }

    this.pending += token;
    const fenceIndex = this.pending.indexOf(UI_FENCE_OPEN);
    if (fenceIndex !== -1) {
      const visible = this.pending.slice(0, fenceIndex);
      this.captured = this.pending.slice(fenceIndex);
      this.pending = '';
      this.capturing = true;
      return visible;
    }

    // Hold back a tail as long as the fence marker minus one char, in case
    // it's split across this token and the next one.
    const holdback = UI_FENCE_OPEN.length - 1;
    if (this.pending.length <= holdback) return '';

    const visible = this.pending.slice(0, this.pending.length - holdback);
    this.pending = this.pending.slice(this.pending.length - holdback);
    return visible;
  }

  /**
   * Call once the underlying model stream has ended.
   * `trailingVisible` is any held-back text that turned out not to be a
   * fence and must still be flushed; `rawUiBlock` is the full captured
   * ```ui ...``` text (unparsed), or null if no fence was ever seen.
   */
  finish(): { trailingVisible: string; rawUiBlock: string | null } {
    if (this.capturing) {
      return { trailingVisible: '', rawUiBlock: this.captured };
    }
    return { trailingVisible: this.pending, rawUiBlock: null };
  }
}
