import { marked, type Tokens } from 'marked';
import { highlightCode } from './code-highlighter';
import { registerCodeSnippet } from './code-snippet-store';

/**
 * Builds the interactive code-block markup: header (language label, and the
 * Copy / Wrap / line-number buttons) plus a highlighted, per-line `<pre>`.
 *
 * This same function backs BOTH interactive surfaces in the app:
 *  - `marked`'s custom `renderer.code` hook (`codeBlockRenderer` below),
 *    used by chat-window's and markdown-block's `renderMarkdown()` for
 *    fenced code inside Markdown - the far more common path, since most
 *    code arrives as part of a Markdown answer rather than as a standalone
 *    CODE_BLOCK UIComponent.
 *  - `code-block.component.ts`, the standalone CODE_BLOCK UIComponent
 *    (used only when code needs to stand apart FROM the Markdown answer;
 *    see the backend's prompt guidance).
 *
 * Why buttons are `<span role="button" tabindex="0" class="...">` and not
 * `<button data-*="...">`: this HTML string is bound via `[innerHTML]`
 * everywhere it's used, which routes through `DOMPurify.sanitize()` and
 * then Angular's OWN built-in `DomSanitizer.sanitize(SecurityContext.HTML)`
 * as a second, independent layer (see `sanitize-html.ts`). DOMPurify would
 * happily keep a `<button>` and `data-*` attributes, but Angular's
 * sanitizer has its own, much stricter allowlist
 * (`@angular/core`'s `VALID_ELEMENTS`/`VALID_ATTRS`) that does NOT include
 * `button` or any `data-*` attribute at all - both get silently stripped,
 * which would leave inert text behind and no way to identify which snippet
 * a click belongs to. `span`, `role`, `tabindex`, `aria-*`, and `class` are
 * all on that allowlist, so the interactive markup uses those instead, and
 * the snippet id rides in an otherwise-meaningless `code-id-<id>` CSS class
 * (class VALUES aren't filtered by either sanitizer, only the presence of
 * the `class` attribute itself is checked) rather than in a `data-*`
 * attribute. See `code-block-interactions.ts` for the click-delegation side
 * of this.
 */
export function renderCodeBlockHtml(params: { code: string; language?: string; fileName?: string }): string {
  const { code, language, fileName } = params;
  const { languageKey, languageLabel, lines } = highlightCode(code, language);
  const id = registerCodeSnippet(languageKey ?? language ?? 'plaintext', code);
  const idClass = `code-id-${id}`;

  const title = escapeAttr(fileName || languageLabel);
  const showLanguageBadge = Boolean(fileName);

  const codeLines = lines.map((line) => `<span class="code-line">${line}</span>`).join('');

  return (
    `<div class="code-block-wrap">` +
    `<div class="code-block-header">` +
    `<span class="code-block-title">${title}</span>` +
    (showLanguageBadge ? `<span class="code-block-lang-badge">${escapeAttr(languageLabel)}</span>` : '') +
    `<div class="code-block-actions">` +
    `<span class="code-block-btn ${idClass} code-linenum-toggle" role="button" tabindex="0" aria-pressed="false" aria-label="Toggle line numbers">#</span>` +
    `<span class="code-block-btn ${idClass} code-wrap-toggle" role="button" tabindex="0" aria-pressed="false" aria-label="Toggle line wrap">Wrap</span>` +
    `<span class="code-block-btn ${idClass} code-copy-btn" role="button" tabindex="0" aria-label="Copy code">Copy</span>` +
    `</div>` +
    `</div>` +
    `<pre class="code-block-pre ${idClass}"><code class="hljs${languageKey ? ` language-${languageKey}` : ''} code-block-code">${codeLines}</code></pre>` +
    `</div>`
  );
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `marked` `renderer.code` hook - see `renderCodeBlockHtml` above for the shared logic. */
export function codeBlockRenderer({ text, lang }: Tokens.Code): string {
  return renderCodeBlockHtml({ code: text, language: lang });
}

let markedConfigured = false;

/**
 * Configures the shared `marked` singleton once: GFM + soft line breaks
 * (matching this app's existing options) plus the highlighting code
 * renderer above. `marked` is a module-level singleton - importing it from
 * chat-window.component.ts and markdown-block.component.ts both resolve to
 * the same instance - so this only needs to run once no matter which of
 * those two modules happens to load first. Both should still import this
 * module (for its side effect) rather than assume the other one already
 * ran it.
 */
export function configureMarkedForCodeBlocks(): void {
  if (markedConfigured) return;
  markedConfigured = true;
  marked.setOptions({ gfm: true, breaks: true });
  marked.use({ renderer: { code: codeBlockRenderer } });
}
