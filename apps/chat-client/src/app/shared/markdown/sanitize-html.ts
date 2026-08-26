import { SecurityContext } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import DOMPurify from 'dompurify';

/**
 * Shared sanitize step for every `[innerHTML]`-bound surface that renders
 * `marked`-generated HTML (chat-window's main reply, the MARKDOWN
 * UIComponent, and the highlighted-HTML the standalone CODE_BLOCK
 * UIComponent builds for consistency with the other two). `DOMPurify`
 * strips anything executable, then Angular's own `DomSanitizer` sanitizes
 * the result as a second, independent layer before it's trusted for
 * `[innerHTML]` - never trust one sanitizer alone for content that
 * ultimately originates from an LLM. This was previously duplicated
 * verbatim in chat-window.component.ts and markdown-block.component.ts;
 * factored out here so the one sanitization policy lives in one place.
 */
export function sanitizeGeneratedHtml(rawHtml: string, sanitizer: DomSanitizer): string {
  if (!rawHtml) return '';
  const cleanHtml = DOMPurify.sanitize(rawHtml);
  return sanitizer.sanitize(SecurityContext.HTML, cleanHtml) ?? '';
}
