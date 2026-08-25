import { describe, it, expect } from 'vitest';
import { ToolResultLeakStreamFilter } from './tool-leak-stream-filter';

/** Streams `text` through the filter one character at a time and returns
 * everything the filter released, in order - the worst case for any
 * streaming filter (every possible split point exercised). */
function streamCharByChar(filter: ToolResultLeakStreamFilter, text: string): string {
  let out = '';
  for (const ch of text) out += filter.push(ch);
  out += filter.finish();
  return out;
}

describe('ToolResultLeakStreamFilter', () => {
  it('passes normal prose through untouched', () => {
    const filter = new ToolResultLeakStreamFilter();
    const text =
      "It's a pleasant day in Pune - about 30°C, clear skies, moderate humidity and a light breeze. " +
      'Let me know if you want the extended forecast.';
    expect(streamCharByChar(filter, text)).toBe(text);
  });

  it('passes prose containing an unrelated brace/object through untouched', () => {
    const filter = new ToolResultLeakStreamFilter();
    const text = 'In math, a set is often written like { 1, 2, 3 } - just a collection of elements.';
    expect(streamCharByChar(filter, text)).toBe(text);
  });

  it('passes a single known field name near a brace through untouched (needs 2+ hits)', () => {
    const filter = new ToolResultLeakStreamFilter();
    // Only one recognized key ("symbol") appears - below the co-occurrence
    // threshold, so this must not be held back or dropped.
    const text = 'The config object looks like { "symbol": "debug" } once compiled.';
    expect(streamCharByChar(filter, text)).toBe(text);
  });

  it('catches a genuine weather tool-result leak with no fence, char by char', () => {
    const filter = new ToolResultLeakStreamFilter();
    const leak =
      '{"location":"Pune, Maharashtra, India","current":{"temperature":30.1,"condition":"Clear sky",' +
      '"humidity":41,"windSpeed":9.4},"forecast":[]}';
    const text = `Here's the data I got back: ${leak} Let me know if that helps.`;
    const result = streamCharByChar(filter, text);
    expect(result).not.toContain('"location"');
    expect(result).not.toContain('"windSpeed"');
    expect(result).toContain("Here's the data I got back:");
    expect(result).toContain('Let me know if that helps.');
  });

  it('catches a genuine stock tool-result leak with no fence, char by char', () => {
    const filter = new ToolResultLeakStreamFilter();
    const leak = '{"symbol":"AAPL","name":"Apple Inc.","price":227.5,"change":1.2,"changePercent":0.53,"currency":"USD"}';
    const text = `Sure, here's what the tool returned: ${leak}`;
    const result = streamCharByChar(filter, text);
    expect(result).not.toContain('"changePercent"');
    expect(result).not.toContain('"symbol"');
    expect(result).toContain("Sure, here's what the tool returned:");
  });

  it('catches a leak fed as one single large token (not char by char)', () => {
    const filter = new ToolResultLeakStreamFilter();
    const leak = '{"location":"Tokyo","current":{"temperature":22,"humidity":55,"windSpeed":3.1}}';
    const out = filter.push(`Weather right now: ${leak}`) + filter.finish();
    expect(out).toBe('Weather right now: ');
  });

  it('does NOT intercept a legitimate fenced code block with similar-looking keys', () => {
    const filter = new ToolResultLeakStreamFilter();
    const text =
      "Here's an example of the shape a weather API response might take:\n\n" +
      '```json\n' +
      '{"location": "Springfield", "current": {"temperature": 70, "humidity": 50, "windSpeed": 5}}\n' +
      '```\n\n' +
      'You would parse that on your end.';
    expect(streamCharByChar(filter, text)).toBe(text);
  });

  it('does not intercept a leak-shaped object inside a fence even when streamed in awkward chunks', () => {
    const filter = new ToolResultLeakStreamFilter();
    const chunks = [
      "Example:\n```",
      'json\n{"locat',
      'ion": "X", "cur',
      'rent": {"windSpeed": 1}}\n``',
      '`\ndone',
    ];
    let out = '';
    for (const c of chunks) out += filter.push(c);
    out += filter.finish();
    expect(out).toBe(chunks.join(''));
  });

  it('resumes normal streaming for text that follows a dropped leak', () => {
    const filter = new ToolResultLeakStreamFilter();
    const leak = '{"symbol":"TSLA","changePercent":-2.1}';
    const text = `Before. ${leak} After, all good.`;
    const result = streamCharByChar(filter, text);
    expect(result).toBe('Before.  After, all good.');
  });

  it('handles a leak candidate that never resolves before the stream ends (unbalanced braces)', () => {
    const filter = new ToolResultLeakStreamFilter();
    // Stream ends mid-object - braces never balance. Must not hang onto it
    // forever or throw; the safest call is to drop the fragment.
    const text = 'Partial: {"location":"X","current":{"windSpeed":1';
    const result = streamCharByChar(filter, text);
    expect(result).toBe('Partial: ');
  });

  it('flushes a false-positive candidate exactly as written once the window resolves negative', () => {
    const filter = new ToolResultLeakStreamFilter();
    // A brace immediately followed by a field-shaped key but only ONE
    // recognized name within the lookahead window - not a leak, must be
    // released verbatim (delay is fine, dropping is not).
    const text = `Consider the object { "symbol": "x" } and note it has ${'y'.repeat(320)} trailing padding.`;
    expect(streamCharByChar(filter, text)).toBe(text);
  });
});
