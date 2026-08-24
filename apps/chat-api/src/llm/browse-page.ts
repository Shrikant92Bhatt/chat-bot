import { JSDOM } from 'jsdom';

/**
 * Fetches a web page and extracts its main readable text.
 *
 * This is the depth half of the research path: `web_search` (see
 * web-search.ts) returns a grounded summary plus citation URLs, but a
 * summary is lossy - exact figures, tables, dates and the reasoning behind
 * a claim usually only exist in the source itself. browse_page is what lets
 * the planner follow a promising citation and read it properly.
 *
 * Extraction is deliberately simple rather than a full readability port:
 * strip the elements that are never article content (script/style/nav/
 * header/footer/aside/form), prefer the most specific container that
 * actually looks like the article (<article>, <main>, or the densest
 * <div>), then take its textContent and normalize whitespace. No
 * dependency beyond jsdom, which the workspace already ships.
 */

/** Wall-clock cap on the fetch - a slow page must never hold up a turn. */
const FETCH_TIMEOUT_MS = 10000;
/** Cap on bytes read from the response before extraction. */
const MAX_HTML_BYTES = 2 * 1024 * 1024;
/** Cap on the text handed back to the model. */
const MAX_TEXT_CHARS = 12000;

/** Elements that are never the article body. */
const CHROME_SELECTORS = 'script, style, noscript, nav, header, footer, aside, form, iframe, svg, template';

export interface BrowsePageResult {
  url: string;
  title: string;
  text: string;
  /** True when the extracted text was cut off at MAX_TEXT_CHARS. */
  truncated: boolean;
}

/**
 * Rejects anything that isn't a plain public http(s) URL.
 *
 * The URL reaching this function is chosen by the model, usually from a
 * search citation - which makes it attacker-influenceable in exactly the
 * way SSRF cares about. Blocking loopback/link-local/private ranges keeps
 * a crafted "read this page" from turning the API server into a proxy for
 * its own metadata service or anything else inside the VPC.
 */
function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`"${raw}" is not a valid URL.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs can be browsed.');
  }

  const host = url.hostname.toLowerCase();

  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  ) {
    throw new Error('Refusing to browse a loopback or internal address.');
  }

  // IPv4 literals in the private/loopback/link-local ranges. Hostnames that
  // merely *resolve* to a private IP aren't caught here (that needs a
  // resolve-then-connect check); this blocks the direct-literal case, which
  // is the one a model actually produces.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    const isPrivate =
      a === 127 || // loopback
      a === 10 || // private
      a === 0 ||
      (a === 192 && b === 168) || // private
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 169 && b === 254) || // link-local (cloud metadata)
      a >= 224; // multicast / reserved
    if (isPrivate) {
      throw new Error('Refusing to browse a private or reserved IP address.');
    }
  }

  return url;
}

/**
 * Picks the element most likely to hold the article body. <article> and
 * <main> are honoured when present (they're semantic and usually right);
 * otherwise the densest <div> by text length wins, which on a typical news
 * page is the story container rather than the page shell.
 */
function pickContentRoot(document: Document): Element {
  const semantic = document.querySelector('article') || document.querySelector('main');
  if (semantic && (semantic.textContent || '').trim().length > 200) {
    return semantic;
  }

  let best: Element = document.body || document.documentElement;
  let bestLength = (best.textContent || '').trim().length;

  for (const div of Array.from(document.querySelectorAll('div'))) {
    const length = (div.textContent || '').trim().length;
    // Strictly greater, so the outermost container wins ties and we don't
    // descend into an arbitrary equally-long child.
    if (length > bestLength) {
      best = div;
      bestLength = length;
    }
  }

  return best;
}

/** Collapses the runs of whitespace that survive textContent extraction. */
function normalizeText(raw: string): string {
  return raw
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Turns fetched HTML into the readable-text result. Split out from the
 * fetch so the extraction rules are testable on fixture HTML without a
 * network round trip (and so a parsing change can be verified without
 * depending on some live page keeping its markup stable).
 */
export function extractReadableText(html: string, url: string): BrowsePageResult {
  // runScripts defaults to 'outside-only', so page scripts never execute -
  // this parses the markup without running anything the page shipped.
  const dom = new JSDOM(html, { url });
  const { document } = dom.window;

  const title = (document.querySelector('title')?.textContent || '').trim() || new URL(url).hostname;

  for (const node of Array.from(document.querySelectorAll(CHROME_SELECTORS))) {
    node.remove();
  }

  const root = pickContentRoot(document);
  const full = normalizeText(root.textContent || '');
  const truncated = full.length > MAX_TEXT_CHARS;

  // Free the DOM eagerly rather than waiting for GC - these are large and a
  // research turn parses several pages in a row.
  dom.window.close();

  if (!full) {
    throw new Error('No readable text could be extracted from the page.');
  }

  return {
    url,
    title,
    text: truncated ? full.slice(0, MAX_TEXT_CHARS) : full,
    truncated,
  };
}

export async function browsePage(rawUrl: string): Promise<BrowsePageResult> {
  const url = assertSafeUrl(rawUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Some publishers return a stub or a 403 to an unidentified client.
        'User-Agent': 'Mozilla/5.0 (compatible; NexusAI/1.0; +https://nexusai-gcp.duckdns.org)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      throw new Error(`Page returned HTTP ${response.status}.`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('html') && !contentType.includes('xml') && contentType !== '') {
      throw new Error(`Unsupported content type "${contentType}" - only HTML pages can be browsed.`);
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_HTML_BYTES) {
      throw new Error('Page is too large to browse.');
    }
    html = new TextDecoder('utf-8').decode(buffer);
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Timed out after ${FETCH_TIMEOUT_MS / 1000}s fetching the page.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  return extractReadableText(html, url.toString());
}
