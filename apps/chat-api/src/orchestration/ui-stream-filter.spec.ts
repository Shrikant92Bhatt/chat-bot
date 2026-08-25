import { describe, it, expect } from 'vitest';
import { UiBlockStreamFilter } from './ui-stream-filter';

describe('UiBlockStreamFilter', () => {
  it('streams plain prose through untouched, token by token', () => {
    const filter = new UiBlockStreamFilter();
    const tokens = ['Hello', ', ', 'this ', 'is ', 'a ', 'normal ', 'reply', ' with ', 'no ', 'UI ', 'block.'];
    let visible = '';
    for (const t of tokens) visible += filter.push(t);
    const { trailingVisible, rawUiBlock } = filter.finish();
    visible += trailingVisible;
    expect(visible).toBe(tokens.join(''));
    expect(rawUiBlock).toBeNull();
  });

  it('withholds a trailing ```ui fenced block from the visible stream and captures it whole', () => {
    const filter = new UiBlockStreamFilter();
    const prose = 'The weather in Pune is sunny.';
    const fence = '```ui\n{"ui":[{"type":"TEXT","id":"a","data":{"text":"x"}}],"sources":[],"actions":[]}\n```';
    const full = prose + fence;

    // Push in small, uneven chunks to simulate real token streaming.
    let visible = '';
    for (let i = 0; i < full.length; i += 3) {
      visible += filter.push(full.slice(i, i + 3));
    }
    const { trailingVisible, rawUiBlock } = filter.finish();
    visible += trailingVisible;

    expect(visible).toBe(prose);
    expect(rawUiBlock).toBe(fence);
  });

  it('never lets the fence marker itself appear in the visible output even split across pushes', () => {
    const filter = new UiBlockStreamFilter();
    const parts = ['no fence here', '`', '`', '`', 'ui\n{}\n```'];
    let visible = '';
    for (const p of parts) visible += filter.push(p);
    const { trailingVisible } = filter.finish();
    visible += trailingVisible;
    expect(visible).toBe('no fence here');
    expect(visible).not.toContain('```ui');
  });

  it('flushes held-back text on finish() when no fence ever arrives', () => {
    const filter = new UiBlockStreamFilter();
    // Ends with a near-miss ("``u" is not the fence marker) that must still
    // be flushed rather than swallowed.
    const visible = filter.push('reply ending in a code span `code``u');
    const { trailingVisible, rawUiBlock } = filter.finish();
    expect(visible + trailingVisible).toBe('reply ending in a code span `code``u');
    expect(rawUiBlock).toBeNull();
  });
});
