import { describe, it, expect } from 'vitest';
import { extractReadableText, browsePage } from './browse-page';

describe('browse_page: readable-text extraction', () => {
  const newsHtml = `<html><head><title>Nifty closes higher</title></head><body>
    <nav>Home Markets Login Subscribe</nav>
    <header>MoneyNews<script>trackUser()</script></header>
    <article><h1>Nifty closes 1.2% higher</h1>
      <p>The Nifty 50 ended at 24,850, up 1.2% on the day.</p>
      <p>Banking stocks led the gains.</p></article>
    <aside>Related: 10 stocks to watch</aside>
    <footer>(c) 2026 MoneyNews. All rights reserved.</footer>
    <style>.ad{display:none}</style></body></html>`;

  it('keeps the article body and drops the page chrome', () => {
    const result = extractReadableText(newsHtml, 'https://news.test/nifty');

    expect(result.title).toBe('Nifty closes higher');
    expect(result.text).toContain('24,850');
    expect(result.text).toContain('Banking stocks');

    // The whole point of the tool: a model reading this should not have to
    // wade through nav links and cookie notices to find the figure.
    expect(result.text).not.toContain('Subscribe');
    expect(result.text).not.toContain('All rights reserved');
    expect(result.text).not.toContain('Related:');
    expect(result.text).not.toContain('trackUser');
    expect(result.text).not.toContain('display:none');
    expect(result.truncated).toBe(false);
  });

  it('falls back to the densest div when a page has no <article>', () => {
    const html = `<html><head><title>T</title></head><body><nav>menu</nav>
      <div id="shell"><div id="story">${'The quarterly report showed revenue of $4.2M. '.repeat(20)}</div></div>
      </body></html>`;

    const result = extractReadableText(html, 'https://x.test/a');
    expect(result.text).toContain('$4.2M');
    expect(result.text).not.toContain('menu');
  });

  it('falls back to the hostname when the page has no title', () => {
    const html = `<html><body><article>${'Body text here. '.repeat(30)}</article></body></html>`;
    expect(extractReadableText(html, 'https://nohead.test/p').title).toBe('nohead.test');
  });

  it('truncates a very long page and flags that it did', () => {
    const html = `<html><head><title>L</title></head><body><article>${'word '.repeat(60000)}</article></body></html>`;
    const result = extractReadableText(html, 'https://long.test');

    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(12000);
  });

  it('throws rather than returning an empty result', () => {
    expect(() =>
      extractReadableText('<html><head><title>Empty</title></head><body><script>x=1</script></body></html>', 'https://e.test')
    ).toThrow(/No readable text/);
  });

  it('collapses the whitespace runs that survive textContent', () => {
    const result = extractReadableText(
      '<html><head><title>W</title></head><body><article><p>alpha</p>\n\n\n   <p>beta</p></article></body></html>',
      'https://w.test'
    );
    expect(result.text).not.toMatch(/\n{3,}/);
    expect(result.text).not.toMatch(/ {2}/);
  });
});

describe('browse_page: SSRF and scheme guards', () => {
  // The URL browse_page receives is picked by the model, usually from a
  // search citation - attacker-influenceable in exactly the way SSRF cares
  // about. Each of these must be refused before any request goes out.
  it.each([
    ['loopback hostname', 'http://localhost:3000/admin'],
    ['loopback IP', 'http://127.0.0.1/'],
    ['cloud metadata endpoint', 'http://169.254.169.254/latest/meta-data/'],
    ['private 10.x range', 'http://10.0.0.5/internal'],
    ['private 192.168.x range', 'http://192.168.1.1/'],
    ['private 172.16.x range', 'http://172.16.0.1/'],
    ['internal TLD', 'http://vault.internal/secret'],
    ['file scheme', 'file:///etc/passwd'],
    ['not a URL', 'not-a-url'],
  ])('refuses %s', async (_label, url) => {
    await expect(browsePage(url)).rejects.toThrow();
  });
});
