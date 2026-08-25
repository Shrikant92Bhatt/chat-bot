import { getCodeSnippet } from './code-snippet-store';

/**
 * Handles a click anywhere inside a rendered code block's markup.
 *
 * The Copy / Wrap / line-number buttons produced by `code-block-renderer.ts`
 * live inside `[innerHTML]`-bound content (or, for the standalone
 * `CodeBlockComponent`, content built the same way for consistency), so
 * they can't carry Angular `(click)` bindings of their own - Angular only
 * compiles bindings that exist in a component's own template, not in a
 * string handed to `[innerHTML]`. Each surface instead attaches ONE
 * `(click)` listener on the real, Angular-templated container element that
 * wraps the generated HTML, and delegates from there via
 * `event.target.closest(...)`, exactly like a native event-delegation
 * pattern. This function is that shared delegation logic so chat-window,
 * markdown-block, and code-block don't each reimplement it.
 */
export function handleCodeBlockClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const button = target.closest('.code-block-btn');
  if (!(button instanceof HTMLElement)) return;

  const id = extractSnippetId(button);
  if (!id) return;

  if (button.classList.contains('code-copy-btn')) {
    void copySnippet(button, id);
  } else if (button.classList.contains('code-wrap-toggle')) {
    toggleWrap(button);
  } else if (button.classList.contains('code-linenum-toggle')) {
    toggleLineNumbers(button);
  }
}

function extractSnippetId(button: HTMLElement): string | null {
  for (const className of button.classList) {
    if (className.startsWith('code-id-')) return className.slice('code-id-'.length);
  }
  return null;
}

// Pending "Copied" -> "Copy" reset timers, keyed by the button element
// itself. A WeakMap (rather than an expando property on the element) keeps
// this out of the DOM and lets a removed button get garbage collected
// normally; keyed per-button so rapid repeat clicks restart the same
// button's timer instead of two buttons' timers colliding.
const copyResetTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

async function copySnippet(button: HTMLElement, id: string): Promise<void> {
  const text = getCodeSnippet(id);
  if (text === undefined) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    console.error('[CodeBlock] Copy to clipboard failed:', e);
    return;
  }

  const existingTimer = copyResetTimers.get(button);
  if (existingTimer) clearTimeout(existingTimer);

  button.textContent = 'Copied';
  button.classList.add('copied');
  button.setAttribute('aria-label', 'Copied to clipboard');

  const timer = setTimeout(() => {
    button.textContent = 'Copy';
    button.classList.remove('copied');
    button.setAttribute('aria-label', 'Copy code');
    copyResetTimers.delete(button);
  }, 2000);
  copyResetTimers.set(button, timer);
}

function toggleWrap(button: HTMLElement): void {
  const wrap = button.closest('.code-block-wrap');
  const pre = wrap?.querySelector('.code-block-pre');
  if (!pre) return;

  const nowWrapped = pre.classList.toggle('wrap-enabled');
  button.setAttribute('aria-pressed', String(nowWrapped));
  button.classList.toggle('active', nowWrapped);
}

function toggleLineNumbers(button: HTMLElement): void {
  const wrap = button.closest('.code-block-wrap');
  if (!wrap) return;

  const nowShown = wrap.classList.toggle('show-line-numbers');
  button.setAttribute('aria-pressed', String(nowShown));
  button.classList.toggle('active', nowShown);
}
