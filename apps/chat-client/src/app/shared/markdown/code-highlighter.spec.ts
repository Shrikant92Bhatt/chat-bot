import { describe, it, expect } from 'vitest';
import { highlightCode } from './code-highlighter';

describe('code-highlighter', () => {
  it('highlights a recognized language and reports its canonical key + label', () => {
    const result = highlightCode('const x = 1;', 'javascript');
    expect(result.languageKey).toBe('javascript');
    expect(result.languageLabel).toBe('JavaScript');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toContain('hljs-keyword');
  });

  it('resolves a common alias to its canonical language', () => {
    const result = highlightCode('const x: number = 1;', 'ts');
    expect(result.languageKey).toBe('typescript');
    expect(result.languageLabel).toBe('TypeScript');
  });

  it('resolves aliases case-insensitively and trims whitespace', () => {
    const result = highlightCode('print(1)', '  PY  ');
    expect(result.languageKey).toBe('python');
  });

  it('falls back to plain, HTML-escaped text for an unrecognized language', () => {
    const result = highlightCode('<b>not real</b>', 'not-a-real-language');
    expect(result.languageKey).toBeNull();
    expect(result.lines[0]).toBe('&lt;b&gt;not real&lt;/b&gt;');
  });

  it('falls back to plain text when no language is given at all', () => {
    const result = highlightCode('just some text', undefined);
    expect(result.languageKey).toBeNull();
    expect(result.languageLabel).toBe('Plain text');
  });

  it('splits multi-line code into one highlighted fragment per physical line', () => {
    const result = highlightCode('const a = 1;\nconst b = 2;\nconst c = 3;', 'javascript');
    expect(result.lines).toHaveLength(3);
  });

  it('preserves an empty line as an empty fragment', () => {
    const result = highlightCode('const a = 1;\n\nconst b = 2;', 'javascript');
    expect(result.lines).toHaveLength(3);
    expect(result.lines[1]).toBe('');
  });

  it('always HTML-escapes source text, recognized language or not (defense in depth)', () => {
    const malicious = '"<img src=x onerror=alert(1)>"';
    const known = highlightCode(malicious, 'javascript');
    const unknown = highlightCode(malicious, 'not-a-real-language');
    expect(known.lines.join('')).not.toContain('<img');
    expect(unknown.lines.join('')).not.toContain('<img');
  });
});
