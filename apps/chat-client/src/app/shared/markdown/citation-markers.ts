/**
 * Turns bracketed numeric citation markers (`[1]`, `[2]`, `[1][2]`, ...) in
 * rendered Markdown HTML into small clickable chips that jump to the
 * matching numbered entry in the Sources block below a reply (see
 * chat-window.component.html's `*ngFor="let source of msg.sources; let i =
 * index"` — the chip labelled `{{ i + 1 }}`). This is the inline complement
 * to that existing chip list, not a replacement for it: the chip list's own
 * rendering/behavior is untouched.
 *
 * WHAT THIS DOES AND DOES NOT GUARANTEE (best-effort, matching this app's
 * other defense-in-depth passes — see tool-leak-stream-filter.ts and
 * ui-stream-filter.ts on the backend for the same house style):
 *  - A marker only becomes a live, clickable chip when its number falls
 *    within `[1, sourceCount]` for THIS message — the exact range the
 *    Sources block below actually renders chips for. A number outside that
 *    range (an off-by-one, a stray `[7]` on a 3-source answer, a citation
 *    in a message that has no `sources` at all) is left as the ordinary
 *    text it already was — never a dead link, never something that looks
 *    clickable but silently does nothing on click.
 *  - Whether `[n]` in the model's prose actually MEANS "the same source as
 *    chip n below" is a backend prompt guarantee, not something this module
 *    can verify from the client — see orchestration/research.ts's top
 *    module doc comment (backend) for exactly when that numbering is, and
 *    isn't, guaranteed self-consistent end-to-end. This module only
 *    guarantees the number is in-range for the message it appears in, not
 *    that it is semantically the source the model meant.
 *  - Only plain text is scanned, via a DOM walk over already-rendered,
 *    already-sanitized HTML (never a regex over the raw HTML string) — so a
 *    `[1]`-looking substring inside an inline code span, a fenced code
 *    block, or a link's own visible text is left completely untouched.
 *    Regex-over-markup is exactly how you accidentally rewrite text that
 *    happens to live inside an attribute or a `<script>`-adjacent context;
 *    walking real DOM text nodes structurally can't do that.
 */

const CITATION_MARKER_PATTERN = /\[(\d{1,3})\]/g;

/** Cheap pre-check so a message with no bracket-digit text at all (the
 * overwhelming majority of turns, and every token of a still-streaming one
 * until a marker actually arrives) skips the DOM round-trip entirely -
 * renderMarkdown() runs on every change-detection pass while a message
 * streams in, so this needs to be free in the common case. */
function mightContainMarkers(html: string): boolean {
  CITATION_MARKER_PATTERN.lastIndex = 0;
  return CITATION_MARKER_PATTERN.test(html);
}

/** Base class every rendered marker chip carries; code-block-interactions.ts-style
 * click delegation (see citation-marker-interactions.ts) looks for this. */
export const CITATION_MARKER_CLASS = 'citation-marker';

/** Elements whose text content is never eligible for marker rendering. */
const SKIP_TAGS = new Set(['CODE', 'PRE', 'A', 'SCRIPT', 'STYLE']);

export interface CitationMarkerOptions {
  /** msg.sources.length for the message being rendered. A marker citing a number outside [1, sourceCount] renders as plain text. */
  sourceCount: number;
}

/**
 * Scans already-sanitized Markdown HTML for `[n]` citation markers and
 * turns the in-range ones into clickable chip spans (same span+role="button"
 * pattern as code-block-renderer.ts's buttons — see that module's doc
 * comment for why `<span role="button" tabindex="0" class="...">` is used
 * instead of `<button data-*>`: this HTML is bound via `[innerHTML]`, which
 * routes through Angular's own `DomSanitizer` as a second sanitization layer
 * after DOMPurify, and that sanitizer's allowlist strips `button` and any
 * `data-*` attribute outright).
 */
export function renderCitationMarkers(html: string, options: CitationMarkerOptions): string {
  if (!html || options.sourceCount <= 0 || !mightContainMarkers(html)) return html;

  const root = document.createElement('div');
  root.innerHTML = html;
  walk(root, options.sourceCount);
  return root.innerHTML;
}

function walk(node: Node, sourceCount: number): void {
  // Snapshot children before mutating - replaceTextNode() below splices new
  // nodes into the tree, which would otherwise shift a live NodeList out
  // from under this loop mid-iteration.
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      replaceTextNode(child as Text, sourceCount);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      if (SKIP_TAGS.has(el.tagName)) continue;
      walk(el, sourceCount);
    }
  }
}

function replaceTextNode(textNode: Text, sourceCount: number): void {
  const text = textNode.data;
  CITATION_MARKER_PATTERN.lastIndex = 0;
  if (!CITATION_MARKER_PATTERN.test(text)) return;
  CITATION_MARKER_PATTERN.lastIndex = 0;

  const fragment = document.createDocumentFragment();
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = CITATION_MARKER_PATTERN.exec(text))) {
    const [raw, numberText] = match;
    if (match.index > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, match.index)));
    }
    const num = Number(numberText);
    fragment.appendChild(
      num >= 1 && num <= sourceCount ? buildMarkerChip(num) : document.createTextNode(raw)
    );
    cursor = match.index + raw.length;
  }
  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }
  textNode.replaceWith(fragment);
}

/** The number rides in a `citation-marker-num-<n>` class (not `data-*` - see
 * this module's doc comment), which citation-marker-interactions.ts reads
 * back to find the matching source chip below. */
function buildMarkerChip(num: number): HTMLElement {
  const span = document.createElement('span');
  span.className = `${CITATION_MARKER_CLASS} citation-marker-num-${num}`;
  span.setAttribute('role', 'button');
  span.setAttribute('tabindex', '0');
  span.setAttribute('aria-label', `Jump to source ${num}`);
  span.textContent = String(num);
  return span;
}
