import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerCodeSnippet,
  getCodeSnippet,
  hashCodeSnippet,
  __resetCodeSnippetStoreForTests,
} from './code-snippet-store';

describe('code-snippet-store', () => {
  beforeEach(() => {
    __resetCodeSnippetStoreForTests();
  });

  it('returns the exact original text for a registered snippet', () => {
    const code = 'const x = 1;\n  const y = 2;\t// tab and trailing spaces   ';
    const id = registerCodeSnippet('javascript', code);
    expect(getCodeSnippet(id)).toBe(code);
  });

  it('returns undefined for an id that was never registered', () => {
    expect(getCodeSnippet('does-not-exist')).toBeUndefined();
  });

  it('produces a stable id for the same language + code', () => {
    const code = 'print("hello")';
    expect(hashCodeSnippet('python', code)).toBe(hashCodeSnippet('python', code));
  });

  it('produces different ids for different code with the same language', () => {
    expect(hashCodeSnippet('python', 'a = 1')).not.toBe(hashCodeSnippet('python', 'a = 2'));
  });

  it('produces different ids for the same code under different languages', () => {
    const code = 'x = 1';
    expect(hashCodeSnippet('python', code)).not.toBe(hashCodeSnippet('ruby', code));
  });

  it('re-registering identical code reuses the same id (no unbounded growth on re-render)', () => {
    const code = 'const a = 1;';
    const first = registerCodeSnippet('javascript', code);
    const second = registerCodeSnippet('javascript', code);
    expect(first).toBe(second);
  });

  it('produces an id that is safe to embed directly in a CSS class name', () => {
    const id = hashCodeSnippet('javascript', 'const x = "<script>alert(1)</script>";');
    expect(id).toMatch(/^[a-z0-9]+$/);
  });
});
