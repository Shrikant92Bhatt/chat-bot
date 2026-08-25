import { describe, it, expect } from 'vitest';
import { UiBlockStreamFilter } from './ui-stream-filter';
import { ToolResultLeakStreamFilter } from './tool-leak-stream-filter';

/**
 * Exercises UiBlockStreamFilter and ToolResultLeakStreamFilter chained
 * exactly as graph.ts wires them: `leakFilter.push(uiFilter.push(content))`
 * per token, then `uiFilter.finish()` -> `leakFilter.push/finish()` at the
 * end. This is the actual defense-in-depth pipeline, not just the two
 * filters in isolation.
 */
function runPipeline(tokens: string[]): { visible: string; rawUiBlock: string | null } {
  const uiFilter = new UiBlockStreamFilter();
  const leakFilter = new ToolResultLeakStreamFilter();
  let visible = '';

  for (const token of tokens) {
    visible += leakFilter.push(uiFilter.push(token));
  }

  const { trailingVisible, rawUiBlock } = uiFilter.finish();
  visible += (trailingVisible.length > 0 ? leakFilter.push(trailingVisible) : '') + leakFilter.finish();
  return { visible, rawUiBlock };
}

describe('UiBlockStreamFilter + ToolResultLeakStreamFilter pipeline', () => {
  it('leaves an ordinary reply completely untouched', () => {
    const tokens = ['It is ', 'sunny ', 'and warm ', 'in Pune today.'];
    const { visible, rawUiBlock } = runPipeline(tokens);
    expect(visible).toBe(tokens.join(''));
    expect(rawUiBlock).toBeNull();
  });

  it('still withholds a well-formed ```ui block exactly as before (unaffected by the new leak filter)', () => {
    const prose = 'Here is the weather for Pune.';
    const fence = '```ui\n{"ui":[],"sources":[],"actions":[]}\n```';
    const tokens = (prose + fence).match(/[\s\S]{1,4}/g) ?? [];
    const { visible, rawUiBlock } = runPipeline(tokens);
    expect(visible).toBe(prose);
    expect(rawUiBlock).toBe(fence);
  });

  it('catches a raw tool-result leak that has no ```ui fence at all', () => {
    const leak = '{"location":"Pune","current":{"temperature":30,"humidity":40,"windSpeed":5}}';
    const tokens = (`The tool returned: ${leak}`).match(/[\s\S]{1,5}/g) ?? [];
    const { visible, rawUiBlock } = runPipeline(tokens);
    expect(visible).toBe('The tool returned: ');
    expect(rawUiBlock).toBeNull();
  });

  it('does not touch a legitimately fenced JSON example the user asked for', () => {
    const text =
      'Sure, a WEATHER_CARD payload looks like:\n```json\n' +
      '{"location":"X","current":{"temperature":1,"humidity":2,"windSpeed":3}}\n```\nThat is the shape.';
    const tokens = text.match(/[\s\S]{1,6}/g) ?? [];
    const { visible, rawUiBlock } = runPipeline(tokens);
    expect(visible).toBe(text);
    expect(rawUiBlock).toBeNull();
  });
});
