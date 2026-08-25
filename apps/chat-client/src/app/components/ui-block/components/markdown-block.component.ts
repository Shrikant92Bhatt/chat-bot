import { Component, HostListener, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { marked } from 'marked';
import { TextOrMarkdownData } from '@chat-monorepo/shared';
import { configureMarkedForCodeBlocks } from '../../../shared/markdown/code-block-renderer';
import { handleCodeBlockClick } from '../../../shared/markdown/code-block-interactions';
import { sanitizeGeneratedHtml } from '../../../shared/markdown/sanitize-html';

configureMarkedForCodeBlocks();

/**
 * Renders a MARKDOWN UIComponent.
 *
 * One of two places in the ui-block component tree that turn model output
 * into `[innerHTML]` rather than binding it through interpolation (the
 * other is CodeBlockComponent's highlighted output, built via the same
 * renderer this file's fenced code blocks go through). It goes through the
 * same marked + DOMPurify + Angular-sanitizer pipeline
 * chat-window.component.ts uses for the main reply: `marked.parse()`
 * produces HTML from the text, `sanitizeGeneratedHtml()` runs
 * `DOMPurify.sanitize()` to strip anything dangerous (script tags, event
 * handler attributes, ...), then asks Angular's own `DomSanitizer` to
 * sanitize the result as a second, independent layer - never trust one
 * sanitizer alone for content that ultimately originates from an LLM. The
 * backend has already validated the payload against a strict schema and
 * rejected anything HTML-looking (see
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
    return sanitizeGeneratedHtml(rawHtml, this.sanitizer);
  }

  /**
   * Delegated click handler for the Copy/Wrap/line-number buttons injected
   * into fenced code blocks by `configureMarkedForCodeBlocks()`. See
   * `handleCodeBlockClick`'s doc comment for why these can't be normal
   * Angular `(click)` bindings.
   */
  @HostListener('click', ['$event'])
  public onClick(event: Event): void {
    handleCodeBlockClick(event);
  }
}
