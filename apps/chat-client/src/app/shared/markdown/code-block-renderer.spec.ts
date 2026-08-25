import { describe, it, expect, beforeEach } from 'vitest';
import { marked } from 'marked';
import { renderCodeBlockHtml, configureMarkedForCodeBlocks } from './code-block-renderer';
import { getCodeSnippet, __resetCodeSnippetStoreForTests } from './code-snippet-store';

function extractCodeId(html: string): string {
  const match = html.match(/code-id-([a-z0-9]+)/);
  expect(match).not.toBeNull();
  return match ? match[1] : '';
}

describe('renderCodeBlockHtml', () => {
  beforeEach(() => {
    __resetCodeSnippetStoreForTests();
  });

  it('embeds a code-id class the snippet store can resolve back to the exact original text', () => {
    const code = 'function greet() {\n  return "hi";\n}';
    const html = renderCodeBlockHtml({ code, language: 'javascript' });

    const id = extractCodeId(html);
    expect(getCodeSnippet(id)).toBe(code);
  });

  it('never uses <button> or data-* attributes (both get stripped by Angular DomSanitizer)', () => {
    const html = renderCodeBlockHtml({ code: 'x = 1', language: 'python' });
    expect(html).not.toContain('<button');
    expect(html).not.toMatch(/data-[a-z-]+=/);
  });

  it('marks each interactive control with role="button" and tabindex so it stays keyboard-accessible', () => {
    const html = renderCodeBlockHtml({ code: 'x = 1', language: 'python' });
    const controlCount = (html.match(/role="button"/g) ?? []).length;
    expect(controlCount).toBe(3); // copy, wrap, line-numbers
    expect((html.match(/tabindex="0"/g) ?? []).length).toBe(3);
  });

  it('shows the filename as the title and the language as a separate badge when a filename is given', () => {
    const html = renderCodeBlockHtml({ code: 'x = 1', language: 'python', fileName: 'script.py' });
    expect(html).toContain('code-block-title">script.py<');
    expect(html).toContain('code-block-lang-badge">Python<');
  });

  it('shows only the language label when no filename is given', () => {
    const html = renderCodeBlockHtml({ code: 'x = 1', language: 'python' });
    expect(html).toContain('code-block-title">Python<');
    expect(html).not.toContain('code-block-lang-badge');
  });

  it('HTML-escapes an untrusted filename before embedding it', () => {
    const html = renderCodeBlockHtml({ code: 'x = 1', language: 'python', fileName: '"><img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('wraps each source line in its own block element for CSS line numbering', () => {
    const html = renderCodeBlockHtml({ code: 'a\nb\nc', language: 'plaintext' });
    expect((html.match(/class="code-line"/g) ?? []).length).toBe(3);
  });
});

describe('configureMarkedForCodeBlocks + marked integration', () => {
  beforeEach(() => {
    __resetCodeSnippetStoreForTests();
    configureMarkedForCodeBlocks();
  });

  it('routes fenced code blocks through the highlighting renderer', () => {
    const html = marked.parse('Some text.\n\n```js\nconst a = 1;\n```\n', { async: false }) as string;
    expect(html).toContain('code-block-wrap');
    expect(html).toContain('hljs-keyword');
  });

  it('round-trips the exact original fenced code through the snippet store', () => {
    const code = 'def greet():\n    return "hi"';
    const html = marked.parse(`\`\`\`python\n${code}\n\`\`\`\n`, { async: false }) as string;
    expect(getCodeSnippet(extractCodeId(html))).toBe(code);
  });
});
