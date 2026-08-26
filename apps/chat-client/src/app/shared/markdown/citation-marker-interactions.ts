import { CITATION_MARKER_CLASS } from './citation-markers';

/**
 * Handles a click on a rendered inline citation marker chip (see
 * `citation-markers.ts`), scrolling the matching numbered chip in the
 * Sources block below into view and briefly highlighting it.
 *
 * Same event-delegation shape as `code-block-interactions.ts`'s
 * `handleCodeBlockClick` and for the same reason: the marker chip lives
 * inside `[innerHTML]`-bound content and can't carry an Angular `(click)`
 * binding of its own, so chat-window attaches one delegated listener on the
 * real, Angular-templated container and finds the chip via
 * `event.target.closest(...)`.
 *
 * The marker and the source chip it targets can be arbitrarily far apart in
 * the DOM (the marker lives inside `.markdown-body`, the chip inside the
 * sibling Sources block), so this walks up to the nearest element carrying
 * `data-message-id` (set on each assistant message's container in
 * chat-window.component.html) and searches only inside THAT message's own
 * subtree for `[data-source-index="n"]` - never across messages, so two
 * different replies each citing "[1]" can never cross-highlight each
 * other's sources.
 *
 * Silently does nothing if the marker, its message container, or the
 * matching chip can't be found - this only ever runs on a marker this
 * app's own `renderCitationMarkers()` already validated as in-range for its
 * message, so a miss here would mean the DOM changed out from under a
 * stale reference, not a real citation mismatch; there is nothing safe to
 * show the user for that case beyond doing nothing.
 */
export function handleCitationMarkerClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const marker = target.closest(`.${CITATION_MARKER_CLASS}`);
  if (!(marker instanceof HTMLElement)) return;

  const num = extractMarkerNumber(marker);
  if (num === null) return;

  const messageContainer = marker.closest('[data-message-id]');
  if (!messageContainer) return;

  const chip = messageContainer.querySelector(`[data-source-index="${num}"]`);
  if (!(chip instanceof HTMLElement)) return;

  chip.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  flashHighlight(chip);
}

function extractMarkerNumber(marker: HTMLElement): number | null {
  for (const className of marker.classList) {
    if (className.startsWith('citation-marker-num-')) {
      const num = Number(className.slice('citation-marker-num-'.length));
      return Number.isFinite(num) ? num : null;
    }
  }
  return null;
}

// Pending highlight-removal timers, keyed by the chip element itself - same
// WeakMap-per-element pattern code-block-interactions.ts uses for its
// "Copied" reset, so clicking the same marker twice restarts one timer
// instead of two colliding, and a chip that leaves the DOM (thread switch)
// is free to be garbage collected rather than pinned by a stale key.
const highlightResetTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function flashHighlight(chip: HTMLElement): void {
  const existing = highlightResetTimers.get(chip);
  if (existing) clearTimeout(existing);

  chip.classList.add('citation-source-highlight');
  const timer = setTimeout(() => {
    chip.classList.remove('citation-source-highlight');
    highlightResetTimers.delete(chip);
  }, 1500);
  highlightResetTimers.set(chip, timer);
}
