import { Component, Input, SecurityContext } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { TextOrMarkdownData } from '@chat-monorepo/shared';

/**
 * Renders a MARKDOWN UIComponent.
 *
 * This is the one place in the ui-block component tree that turns model
 * output into `[innerHTML]` rather than binding it through interpolation.
 * It goes through the same marked + DOMPurify + Angular-sanitizer pipeline
 * chat-window.component.ts uses for the main reply: `marked.parse()`
 * produces HTML from the text, `DOMPurify.sanitize()` strips anything
 * dangerous (script tags, event handler attributes, ...), and Angular's own
 * `DomSanitizer` is still asked to sanitize the result as a second,
 * independent layer - never trust one sanitizer alone for content that
 * ultimately originates from an LLM. The backend has already validated the
 * payload against a strict schema and rejected anything HTML-looking (see
 * apps/chat-api/src/orchestration/ui-schema.ts), so this is a third layer,
 * not the only one.
 */
@Component({
  selector: 'app-ui-markdown-block',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './markdown-block.component.html',
  host: { style: 'display: contents' },
})
export class MarkdownBlockComponent {
  @Input({ required: true }) data!: TextOrMarkdownData;

  constructor(private sanitizer: DomSanitizer) {}

  public renderMarkdown(content: string): string {
    if (!content) return '';
    const rawHtml = marked.parse(content, { async: false }) as string;
    const cleanHtml = DOMPurify.sanitize(rawHtml);
    return this.sanitizer.sanitize(SecurityContext.HTML, cleanHtml) ?? '';
  }
}
