import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderCitationMarkers } from './citation-markers';
import { handleCitationMarkerClick } from './citation-marker-interactions';

/** Mounts a message container shaped like chat-window.component.html's
 * assistant message: [data-message-id] wrapping both the rendered Markdown
 * (with its citation marker chips) and the Sources chip list
 * ([data-source-index]) as siblings, with one delegated click listener on
 * the container - matching how chat-window.component.ts wires this up in
 * the real app (one @HostListener('click') covering the whole message
 * list). */
function mountMessage(messageId: string, markdownHtml: string, sourceCount: number): HTMLElement {
  const container = document.createElement('div');
  container.setAttribute('data-message-id', messageId);
  container.addEventListener('click', handleCitationMarkerClick);

  const body = document.createElement('div');
  body.className = 'markdown-body';
  body.innerHTML = markdownHtml;
  container.appendChild(body);

  const sources = document.createElement('div');
  for (let i = 1; i <= sourceCount; i++) {
    const chip = document.createElement('a');
    chip.setAttribute('data-source-index', String(i));
    chip.textContent = `Source ${i}`;
    sources.appendChild(chip);
  }
  container.appendChild(sources);

  document.body.appendChild(container);
  return container;
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('handleCitationMarkerClick', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('scrolls the matching source chip into view and highlights it', () => {
    const html = renderCitationMarkers('<p>Claim [2].</p>', { sourceCount: 3 });
    const container = mountMessage('msg-1', html, 3);
    const marker = container.querySelector('.citation-marker-num-2') as HTMLElement;
    const chip = container.querySelector('[data-source-index="2"]') as HTMLElement;
    const scrollIntoView = vi.fn();
    chip.scrollIntoView = scrollIntoView;

    click(marker);

    expect(scrollIntoView).toHaveBeenCalled();
    expect(chip.classList.contains('citation-source-highlight')).toBe(true);
  });

  it('removes the highlight after the flash window', () => {
    vi.useFakeTimers();
    const html = renderCitationMarkers('<p>Claim [1].</p>', { sourceCount: 1 });
    const container = mountMessage('msg-1', html, 1);
    const marker = container.querySelector('.citation-marker-num-1') as HTMLElement;
    const chip = container.querySelector('[data-source-index="1"]') as HTMLElement;
    chip.scrollIntoView = vi.fn();

    click(marker);
    expect(chip.classList.contains('citation-source-highlight')).toBe(true);

    vi.advanceTimersByTime(2000);
    expect(chip.classList.contains('citation-source-highlight')).toBe(false);
  });

  it("never cross-highlights another message's source chip at the same index", () => {
    const htmlA = renderCitationMarkers('<p>Claim [1].</p>', { sourceCount: 1 });
    const htmlB = renderCitationMarkers('<p>Different claim [1].</p>', { sourceCount: 1 });
    const containerA = mountMessage('msg-a', htmlA, 1);
    const containerB = mountMessage('msg-b', htmlB, 1);

    const markerA = containerA.querySelector('.citation-marker-num-1') as HTMLElement;
    const chipA = containerA.querySelector('[data-source-index="1"]') as HTMLElement;
    const chipB = containerB.querySelector('[data-source-index="1"]') as HTMLElement;
    chipA.scrollIntoView = vi.fn();
    chipB.scrollIntoView = vi.fn();

    click(markerA);

    expect(chipA.classList.contains('citation-source-highlight')).toBe(true);
    expect(chipB.classList.contains('citation-source-highlight')).toBe(false);
    expect(chipB.scrollIntoView).not.toHaveBeenCalled();
  });

  it('does nothing when the click is outside any citation marker', () => {
    const container = mountMessage('msg-1', '<p>No markers here.</p>', 2);
    const chip = container.querySelector('[data-source-index="1"]') as HTMLElement;
    chip.scrollIntoView = vi.fn();

    click(container);

    expect(chip.scrollIntoView).not.toHaveBeenCalled();
  });

  it('does nothing when the marker has no enclosing [data-message-id] container', () => {
    const html = renderCitationMarkers('<p>Claim [1].</p>', { sourceCount: 1 });
    const orphan = document.createElement('div');
    orphan.innerHTML = html;
    orphan.addEventListener('click', handleCitationMarkerClick);
    document.body.appendChild(orphan);
    const marker = orphan.querySelector('.citation-marker-num-1') as HTMLElement;

    expect(() => click(marker)).not.toThrow();
  });

  it('does nothing when no matching source chip exists in the message (defensive - renderCitationMarkers should never produce this)', () => {
    const html = renderCitationMarkers('<p>Claim [1].</p>', { sourceCount: 1 });
    // Mount with zero actual chips, simulating a stale/mismatched DOM.
    const container = mountMessage('msg-1', html, 0);
    const marker = container.querySelector('.citation-marker-num-1') as HTMLElement;

    expect(() => click(marker)).not.toThrow();
  });

  it('restarts the highlight window on a second click of the same marker rather than stacking timers', () => {
    vi.useFakeTimers();
    const html = renderCitationMarkers('<p>Claim [1].</p>', { sourceCount: 1 });
    const container = mountMessage('msg-1', html, 1);
    const marker = container.querySelector('.citation-marker-num-1') as HTMLElement;
    const chip = container.querySelector('[data-source-index="1"]') as HTMLElement;
    chip.scrollIntoView = vi.fn();

    click(marker);
    vi.advanceTimersByTime(1000);
    click(marker); // restarts the window
    vi.advanceTimersByTime(1000);
    expect(chip.classList.contains('citation-source-highlight')).toBe(true); // only 1s of the fresh 1.5s window elapsed

    vi.advanceTimersByTime(600);
    expect(chip.classList.contains('citation-source-highlight')).toBe(false);
  });
});
