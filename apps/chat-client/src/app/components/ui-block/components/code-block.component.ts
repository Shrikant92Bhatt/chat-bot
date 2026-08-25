import { Component, HostListener, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { CodeBlockData } from '@chat-monorepo/shared';
import { renderCodeBlockHtml } from '../../../shared/markdown/code-block-renderer';
import { handleCodeBlockClick } from '../../../shared/markdown/code-block-interactions';
import { sanitizeGeneratedHtml } from '../../../shared/markdown/sanitize-html';

/**
 * Renders a CODE_BLOCK UIComponent - used only when the backend decides
 * code needs to stand apart FROM a Markdown answer (see the orchestrator's
 * prompt guidance). Most code the model produces instead arrives as a
 * fenced block inside ordinary Markdown, which goes through the exact same
 * highlighting/copy/wrap markup via `marked`'s renderer.code hook in
 * `code-block-renderer.ts` - this component calls that same builder
 * directly so both surfaces render and behave identically.
 *
 * `data` is bound via `{{ }}` interpolation elsewhere in this component
 * tree (not `[innerHTML]`), but the highlighted output here still has to be
 * `[innerHTML]`-bound (it contains `<span class="hljs-...">` markup from
 * the highlighter and the Copy/Wrap/line-number buttons), so it goes
 * through the same DOMPurify + Angular DomSanitizer pipeline as the
 * Markdown surfaces before being trusted - `data.code` ultimately
 * originates from the LLM, same as everything else in this tree.
 */
@Component({
  selector: 'app-ui-code-block',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './code-block.component.html',
  host: { style: 'display: contents' },
})
export class CodeBlockComponent {
  private readonly dataSignal = signal<CodeBlockData | null>(null);

  @Input({ required: true })
  set data(value: CodeBlockData) {
    this.dataSignal.set(value);
  }

  public readonly renderedHtml = computed<SafeHtml>(() => {
    const data = this.dataSignal();
    if (!data) return this.sanitizer.bypassSecurityTrustHtml('');
    const rawHtml = renderCodeBlockHtml({
      code: data.code,
      language: data.language,
      fileName: data.fileName,
    });
    const cleanHtml = sanitizeGeneratedHtml(rawHtml, this.sanitizer);
    // sanitizeGeneratedHtml already ran this string through DOMPurify and
    // Angular's own SecurityContext.HTML sanitizer - bypassSecurityTrustHtml
    // here just tells Angular not to sanitize it a THIRD time (which would
    // be redundant, not less safe: the string is already clean).
    return this.sanitizer.bypassSecurityTrustHtml(cleanHtml);
  });

  constructor(private sanitizer: DomSanitizer) {}

  /**
   * Delegated click handler for the Copy/Wrap/line-number buttons injected
   * into `renderedHtml` above - see `handleCodeBlockClick`'s doc comment for
   * why these can't be normal Angular `(click)` bindings.
   */
  @HostListener('click', ['$event'])
  public onClick(event: Event): void {
    handleCodeBlockClick(event);
  }
}
