/**
 * Minimal local typings for `jsdom`.
 *
 * jsdom ships no types of its own and `@types/jsdom` isn't installed, so
 * this declares just the surface llm/browse-page.ts actually touches
 * (construct a DOM from an HTML string, query it, close it) rather than
 * pulling in another dependency or falling back to `any` and losing the
 * type checking on the extraction code entirely.
 *
 * If more of the jsdom API is ever needed here, extend this file - or swap
 * it for `@types/jsdom` and delete it.
 */
declare module 'jsdom' {
  interface JSDOMOptions {
    /** Base URL for the document; affects relative-URL resolution. */
    url?: string;
    referrer?: string;
    contentType?: string;
    /**
     * Left unset by browse-page.ts, which keeps jsdom's default of
     * 'outside-only' — page scripts are parsed but never executed.
     */
    runScripts?: 'dangerously' | 'outside-only';
    pretendToBeVisual?: boolean;
  }

  export class JSDOM {
    constructor(html: string, options?: JSDOMOptions);
    readonly window: Window & {
      readonly document: Document;
      close(): void;
    };
    serialize(): string;
  }
}
