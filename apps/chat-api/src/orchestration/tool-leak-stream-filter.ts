/**
 * Best-effort defense-in-depth against a raw tool-result object leaking into
 * the visible reply in prose form (no ```ui fence at all) - the gap
 * UiBlockStreamFilter does not cover, since it only starts withholding once
 * it sees the literal ```ui marker. Prompt hardening (tool_selection:v2,
 * ui_orchestrator:v2) is the primary defense; this is the runtime backstop
 * for when the model doesn't follow it.
 *
 * WHAT THIS DOES vs. DOES NOT GUARANTEE (be honest, this is not a general
 * JSON detector and isn't meant to be one):
 *  - It only reacts to a `{` that is followed, within a bounded lookahead
 *    window, by at least two of a short, curated list of field names that
 *    actually appear in this app's get_weather/get_stock_quote results
 *    (see llm/weather.ts, llm/stock.ts). Requiring two co-occurring names
 *    (rather than one, which is all the field-name match alone would need)
 *    is a deliberate extra margin against false positives - a single word
 *    like "current" or "symbol" appearing near a brace proves nothing by
 *    itself, two of them together in this specific combination is what
 *    narrows it down to "this looks like our tool output".
 *  - It is exempted while inside a fenced code block (```...```), tracked
 *    by toggling a boolean every time a bare ``` marker streams past outside
 *    an active leak-drop. This is a *heuristic*, not a parser: it assumes
 *    fences are well-formed and alternate open/close, same assumption
 *    Markdown itself makes. It cannot know a stray ``` mid-sentence "means"
 *    something different than a real fence - nothing token-by-token could,
 *    short of buffering the entire reply and re-parsing it as Markdown
 *    after the fact, which would defeat the point of a streaming filter
 *    (see the module doc on graph.ts's SSE loop for why that's too late).
 *  - It does NOT know which text came from a ToolMessage vs. the model's
 *    own prose - it only ever sees the flat visible token stream (post
 *    UiBlockStreamFilter), the same limit that filter has. A tool-shaped
 *    JSON blob the user pastes into their own message and asks the model to
 *    reformat, then the model echoes back near-verbatim outside a fence,
 *    would still be caught (and delayed/dropped) by this - a false
 *    positive, but one that fails toward withholding rather than leaking.
 *  - On anything it isn't confident about, it releases the text unchanged,
 *    at most a short delay while it gathers lookahead - it never silently
 *    drops content it hasn't matched the specific pattern above.
 */

/** Field names drawn verbatim from WeatherResult/StockQuoteResult (llm/weather.ts,
 * llm/stock.ts) - kept short and specific rather than exhaustive, since a longer
 * list of generic key names (name, price, currency, time, date...) would just
 * raise the false-positive rate without meaningfully raising the catch rate. */
const LEAK_FIELD_NAMES = [
  'location',
  'current',
  'humidity',
  'forecast',
  'hourly',
  'windSpeed',
  'temperatureHigh',
  'temperatureLow',
  'precipitationProbability',
  'symbol',
  'changePercent',
] as const;

const LEAK_KEY_PATTERN = new RegExp(LEAK_FIELD_NAMES.map((name) => `"${name}"\\s*:`).join('|'), 'g');

/** How far past a candidate `{` to look for field-name hits before giving up on it. */
const LEAK_LOOKAHEAD_WINDOW = 300;

/** Minimum distinct field-name hits within the window before treating a `{` as a real leak. */
const LEAK_MIN_KEY_HITS = 2;

const FENCE_MARKER = '```';

export class ToolResultLeakStreamFilter {
  /** Unclassified tail of the stream - not yet released or confirmed-dropped. */
  private pending = '';
  /** Toggled by every bare ``` marker seen outside an active leak-drop. */
  private inFencedCodeBlock = false;
  /** True while consuming a confirmed leak's body until its braces balance. */
  private droppingLeak = false;
  private leakDepth = 0;

  /** Feed the next chunk of already-visible text (i.e. post-UiBlockStreamFilter). Returns the portion now safe to display. */
  push(text: string): string {
    if (text.length === 0) return '';
    this.pending += text;
    return this.drain(false);
  }

  /** Call once the underlying stream has ended, to flush anything still held back. */
  finish(): string {
    const out = this.drain(true);
    this.pending = '';
    this.droppingLeak = false;
    return out;
  }

  private drain(isFinal: boolean): string {
    let output = '';
    // `i` is the emission cursor - `this.pending.slice(i, ...)` is what
    // actually gets released, and only moves at an explicit output+= below.
    // `scanFrom` is a separate, always->=`i` search cursor for finding the
    // next `{` candidate, so that stepping past a candidate that turned out
    // NOT to be a leak (see bottom of the loop) never drops that text - it
    // stays between `i` and the next release, it's just no longer rescanned.
    let i = 0;
    let scanFrom = 0;

    for (;;) {
      if (this.droppingLeak) {
        while (i < this.pending.length) {
          const ch = this.pending[i];
          if (ch === '{') this.leakDepth++;
          else if (ch === '}') {
            this.leakDepth--;
            if (this.leakDepth <= 0) {
              i++;
              this.droppingLeak = false;
              break;
            }
          }
          i++;
        }
        if (this.droppingLeak) {
          // Braces never balanced within what we've received. On a genuine
          // mid-stream call, wait for more; if the stream just ended, the
          // safest call is to drop the unbalanced fragment rather than
          // release a half-formed object.
          if (isFinal) this.droppingLeak = false;
          this.pending = '';
          return output;
        }
        // Balanced (or gave up on isFinal) - fall through and keep scanning
        // whatever follows the dropped object for further content.
        this.pending = this.pending.slice(i);
        i = 0;
        scanFrom = 0;
        continue;
      }

      let j = scanFrom;
      let candidateIdx = -1;
      while (j < this.pending.length) {
        if (this.pending.startsWith(FENCE_MARKER, j)) {
          this.inFencedCodeBlock = !this.inFencedCodeBlock;
          j += FENCE_MARKER.length;
          continue;
        }
        if (!this.inFencedCodeBlock && this.pending[j] === '{') {
          candidateIdx = j;
          break;
        }
        j++;
      }

      if (candidateIdx === -1) {
        // Nothing suspicious found. Hold back a small tail in case a ```
        // marker is mid-arrival (unless this is the final flush).
        const holdback = isFinal ? 0 : FENCE_MARKER.length - 1;
        const safeEnd = Math.max(i, this.pending.length - holdback);
        output += this.pending.slice(i, safeEnd);
        this.pending = this.pending.slice(safeEnd);
        return output;
      }

      const windowEnd = Math.min(this.pending.length, candidateIdx + LEAK_LOOKAHEAD_WINDOW);
      const windowComplete = isFinal || windowEnd - candidateIdx >= LEAK_LOOKAHEAD_WINDOW;
      const hits = (this.pending.slice(candidateIdx, windowEnd).match(LEAK_KEY_PATTERN) || []).length;

      if (hits >= LEAK_MIN_KEY_HITS) {
        // Confirmed leak candidate - release everything before it, then
        // start silently consuming its (brace-balanced) body.
        output += this.pending.slice(i, candidateIdx);
        this.pending = this.pending.slice(candidateIdx);
        i = 0;
        scanFrom = 0;
        this.droppingLeak = true;
        this.leakDepth = 0;
        continue;
      }

      if (!windowComplete) {
        // Not enough lookahead yet to rule this `{` in or out - hold
        // everything from it onward and wait for more tokens.
        output += this.pending.slice(i, candidateIdx);
        this.pending = this.pending.slice(candidateIdx);
        return output;
      }

      // Full window checked, not enough hits - ordinary `{`, not a leak.
      // It stays queued for release (i is untouched); only the search
      // cursor advances, so we don't re-evaluate the same brace forever
      // while still looking for a possible later candidate.
      scanFrom = candidateIdx + 1;
    }
  }
}
