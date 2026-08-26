import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleCodeBlockClick } from './code-block-interactions';
import { registerCodeSnippet, __resetCodeSnippetStoreForTests } from './code-snippet-store';
import { renderCodeBlockHtml } from './code-block-renderer';

function mountCodeBlock(code: string, language: string): { root: HTMLElement; id: string } {
  const html = renderCodeBlockHtml({ code, language });
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  const match = html.match(/code-id-([a-z0-9]+)/);
  if (!match) throw new Error('renderCodeBlockHtml did not embed a code-id class');
  return { root, id: match[1] };
}

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('handleCodeBlockClick', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetCodeSnippetStoreForTests();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('ignores clicks outside any code-block control', () => {
    const { root } = mountCodeBlock('x = 1', 'python');
    const codeEl = root.querySelector('.code-block-code');
    expect(codeEl).not.toBeNull();
    click(codeEl as Element);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies the exact original code text to the clipboard, not the rendered/highlighted markup', async () => {
    const code = 'const a = 1;\nconst b = "  spaced  ";';
    const { root } = mountCodeBlock(code, 'javascript');
    // Dispatch through the real delegated path, matching how the app wires
    // this up: one listener on the container, event.target is the button.
    root.addEventListener('click', handleCodeBlockClick);
    const copyBtn = root.querySelector('.code-copy-btn') as HTMLElement;

    click(copyBtn);

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
  });

  it('shows a "Copied" state on the clicked button and reverts it after ~2s', async () => {
    vi.useFakeTimers();
    const { root } = mountCodeBlock('x = 1', 'python');
    root.addEventListener('click', handleCodeBlockClick);
    const copyBtn = root.querySelector('.code-copy-btn') as HTMLElement;

    click(copyBtn);
    await vi.advanceTimersByTimeAsync(0); // let the copy promise resolve
    expect(copyBtn.textContent).toBe('Copied');
    expect(copyBtn.classList.contains('copied')).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    expect(copyBtn.textContent).toBe('Copy');
    expect(copyBtn.classList.contains('copied')).toBe(false);
  });

  it('does not fall back to writing an id it cannot resolve in the snippet store', async () => {
    const { root, id } = mountCodeBlock('x = 1', 'python');
    // Simulate a stale/foreign id no longer in the store.
    __resetCodeSnippetStoreForTests();
    registerCodeSnippet('python', 'unrelated code'); // repopulate with something else, not `id`
    root.addEventListener('click', handleCodeBlockClick);
    const copyBtn = root.querySelector('.code-copy-btn') as HTMLElement;
    expect(copyBtn.className).toContain(`code-id-${id}`);

    click(copyBtn);
    await Promise.resolve();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('toggles wrap on the <pre> for this block only, and reflects state via aria-pressed', () => {
    const { root } = mountCodeBlock('x = 1', 'python');
    root.addEventListener('click', handleCodeBlockClick);
    const wrapBtn = root.querySelector('.code-wrap-toggle') as HTMLElement;
    const pre = root.querySelector('.code-block-pre') as HTMLElement;

    expect(pre.classList.contains('wrap-enabled')).toBe(false);
    click(wrapBtn);
    expect(pre.classList.contains('wrap-enabled')).toBe(true);
    expect(wrapBtn.getAttribute('aria-pressed')).toBe('true');

    click(wrapBtn);
    expect(pre.classList.contains('wrap-enabled')).toBe(false);
    expect(wrapBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('toggles line numbers on the wrapper, independently of the wrap toggle', () => {
    const { root } = mountCodeBlock('a\nb', 'python');
    root.addEventListener('click', handleCodeBlockClick);
    const lineNumBtn = root.querySelector('.code-linenum-toggle') as HTMLElement;
    const wrap = root.querySelector('.code-block-wrap') as HTMLElement;

    expect(wrap.classList.contains('show-line-numbers')).toBe(false);
    click(lineNumBtn);
    expect(wrap.classList.contains('show-line-numbers')).toBe(true);
    expect(lineNumBtn.getAttribute('aria-pressed')).toBe('true');
  });
});
