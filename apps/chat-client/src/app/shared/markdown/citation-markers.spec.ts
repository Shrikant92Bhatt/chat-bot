import { describe, it, expect } from 'vitest';
import { renderCitationMarkers, CITATION_MARKER_CLASS } from './citation-markers';

describe('renderCitationMarkers', () => {
  it('turns an in-range [n] into a clickable marker chip', () => {
    const html = renderCitationMarkers('<p>Nifty closed at 24,850 [2].</p>', { sourceCount: 3 });
    expect(html).toContain(`class="${CITATION_MARKER_CLASS} citation-marker-num-2"`);
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Jump to source 2"');
    // The marker's own visible text is just the number.
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(div.querySelector('.citation-marker-num-2')?.textContent).toBe('2');
  });

  it('renders adjacent markers [1][2] as two separate chips', () => {
    const html = renderCitationMarkers('<p>Two sources agree [1][2].</p>', { sourceCount: 2 });
    expect(html).toContain('citation-marker-num-1');
    expect(html).toContain('citation-marker-num-2');
  });

  it('leaves a marker whose number is out of range as ordinary plain text', () => {
    const html = renderCitationMarkers('<p>Overclaimed [7].</p>', { sourceCount: 3 });
    expect(html).not.toContain(CITATION_MARKER_CLASS);
    expect(html).toContain('[7]');
  });

  it('leaves [0] and negative-looking markers as plain text (1-indexed only)', () => {
    const html = renderCitationMarkers('<p>[0] is not a source.</p>', { sourceCount: 5 });
    expect(html).not.toContain(CITATION_MARKER_CLASS);
    expect(html).toContain('[0]');
  });

  it('does nothing at all when the message has no sources', () => {
    const original = '<p>Just a plain reply with [1] that looks like a citation but is not.</p>';
    expect(renderCitationMarkers(original, { sourceCount: 0 })).toBe(original);
  });

  it('renders every marker as plain text when sourceCount is 0, never a dead link', () => {
    const html = renderCitationMarkers('<p>See [1] and [2].</p>', { sourceCount: 0 });
    expect(html).not.toContain('role="button"');
  });

  it('leaves ordinary text with no bracket markers completely untouched', () => {
    const original = '<p>No citations here, just [not-a-number] and text.</p>';
    expect(renderCitationMarkers(original, { sourceCount: 3 })).toBe(original);
  });

  it('never touches a bracket-digit pattern inside a fenced code block', () => {
    const html = renderCitationMarkers(
      '<pre><code>const arr = [1];\nconst x = arr[2];</code></pre>',
      { sourceCount: 3 }
    );
    expect(html).not.toContain(CITATION_MARKER_CLASS);
    expect(html).toContain('arr = [1]');
    expect(html).toContain('arr[2]');
  });

  it('never touches a bracket-digit pattern inside inline code', () => {
    const html = renderCitationMarkers('<p>Use <code>list[1]</code> to index.</p>', { sourceCount: 3 });
    expect(html).not.toContain(CITATION_MARKER_CLASS);
    expect(html).toContain('list[1]');
  });

  it('never touches a bracket-digit pattern inside a link\'s visible text or href', () => {
    const html = renderCitationMarkers(
      '<p><a href="https://x.test/items[1]">Item [1]</a></p>',
      { sourceCount: 3 }
    );
    expect(html).not.toContain(CITATION_MARKER_CLASS);
    expect(html).toContain('Item [1]');
    expect(html).toContain('items[1]');
  });

  it('still finds a marker in a paragraph that also contains an unrelated link', () => {
    const html = renderCitationMarkers(
      '<p>See <a href="https://x.test">this page</a> for background [1].</p>',
      { sourceCount: 2 }
    );
    expect(html).toContain('citation-marker-num-1');
    // The link itself is untouched.
    expect(html).toContain('<a href="https://x.test">this page</a>');
  });

  it('handles multiple valid markers spread across separate sentences', () => {
    const html = renderCitationMarkers(
      '<p>First claim [1]. Second claim [2]. Third claim [3].</p>',
      { sourceCount: 3 }
    );
    expect(html).toContain('citation-marker-num-1');
    expect(html).toContain('citation-marker-num-2');
    expect(html).toContain('citation-marker-num-3');
  });

  it('handles a mix of valid and out-of-range markers in the same message', () => {
    const html = renderCitationMarkers('<p>Real [1], fabricated [9].</p>', { sourceCount: 2 });
    expect(html).toContain('citation-marker-num-1');
    expect(html).not.toContain('citation-marker-num-9');
    expect(html).toContain('[9]');
  });

  it('is idempotent-safe on an empty string', () => {
    expect(renderCitationMarkers('', { sourceCount: 5 })).toBe('');
  });
});
