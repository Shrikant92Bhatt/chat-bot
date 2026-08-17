import { Component, ElementRef, ViewChild, AfterViewChecked, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ChatService } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-chat-window',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chat-window.component.html',
})
export class ChatWindowComponent implements AfterViewChecked {
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef<HTMLElement>;

  // Only auto-scroll while the user is already at (or near) the bottom, so
  // scrolling up to read earlier messages during a stream doesn't keep
  // getting yanked back down on every change-detection pass.
  private shouldAutoScroll = true;
  private readonly bottomThresholdPx = 96;

  // activeMessages() gets a new array/object reference on every streamed
  // token (not just when a message is added), so an effect reading it would
  // rerun on every token. Track count/thread ourselves and only force a
  // scroll when a message was actually added or the thread changed -
  // otherwise every token would re-enable auto-scroll and undo a manual
  // scroll-up mid-stream.
  private previousMessageCount = 0;
  private previousThreadId: string | null = null;

  constructor(
    public chatService: ChatService,
    public authService: AuthService,
    private sanitizer: DomSanitizer
  ) {
    effect(() => {
      const threadId = this.chatService.activeThreadId();
      const count = this.chatService.activeMessages().length;

      if (threadId !== this.previousThreadId || count > this.previousMessageCount) {
        this.shouldAutoScroll = true;
      }

      this.previousThreadId = threadId;
      this.previousMessageCount = count;
    });
  }

  ngAfterViewChecked() {
    if (this.shouldAutoScroll) {
      this.scrollToBottom();
    }
  }

  onScroll(): void {
    const el = this.scrollContainer.nativeElement;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.shouldAutoScroll = distanceFromBottom < this.bottomThresholdPx;
  }

  private scrollToBottom(): void {
    try {
      this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
    } catch (err) {}
  }

  /**
   * Formats raw Markdown into sanitized, safe HTML for rich visual rendering
   */
  public renderMarkdown(content: string): SafeHtml {
    if (!content) return '';

    // Escape all HTML first so markdown formatting is applied on top of
    // inert text - otherwise raw HTML in model output (e.g. from prompt
    // injection) would pass through bypassSecurityTrustHtml unescaped.
    let html = this.escapeHtml(content);

    // 1. Code blocks: ```lang ... ```
    html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
      return `<pre class="bg-abyss/90 border border-glassBorder rounded-xl p-3 my-2 overflow-x-auto text-xs font-mono text-emerald-300"><code>${code.trim()}</code></pre>`;
    });

    // 2. Inline code: `code`
    html = html.replace(/`([^`]+)`/g, (_, code) => {
      return `<code class="bg-black/50 border border-white/10 px-1.5 py-0.5 rounded text-accentCyan font-mono text-xs">${code}</code>`;
    });

    // 3. Bold: **text**
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-white">$1</strong>');

    // 4. Italic: *text* or _text_
    html = html.replace(/\*([^*]+)\*/g, '<em class="italic text-slate-100">$1</em>');

    // 5. Markdown Links: [label](url)
    html = html.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-accentCyan hover:text-cyan-300 underline font-medium transition-colors">$1 ↗</a>'
    );

    // 6. Headings: # / ## / ###
    html = html.replace(/^### (.+)$/gm, '<h3 class="text-sm font-bold text-white mt-3 mb-1">$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2 class="text-base font-bold text-white mt-3 mb-1">$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1 class="text-lg font-bold text-white mt-3 mb-1">$1</h1>');

    // 7. Blockquotes: > text
    html = html.replace(
      /^&gt;\s?(.+)$/gm,
      '<blockquote class="border-l-2 border-accentViolet/50 pl-3 italic text-slate-400 my-1">$1</blockquote>'
    );

    // 8. GFM tables (must run before the line-break pass, needs raw \n to find row boundaries)
    html = this.renderTables(html);

    // 9. Lists: consecutive * / - lines -> one <ul>, consecutive N. lines -> one <ol>.
    // Grouped into a real list element (rather than bare <li>s) so ordered
    // lists get their own counter instead of continuing the count from any
    // preceding bullet items on the page.
    html = html.replace(/^(?:[*-][ \t]+.+(?:\r?\n|$))+/gm, (block) => this.renderListBlock(block, /^[*-][ \t]+/, 'ul', 'list-disc'));
    html = html.replace(/^(?:\d+\.[ \t]+.+(?:\r?\n|$))+/gm, (block) => this.renderListBlock(block, /^\d+\.[ \t]+/, 'ol', 'list-decimal'));

    // 10. Line breaks
    html = html.replace(/\n/g, '<br/>');

    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  /**
   * GFM pipe tables: a header row, a |---|---| separator row, then 1+ body
   * rows.
   */
  private renderTables(html: string): string {
    const tableBlockRegex =
      /^\|(.+)\|[ \t]*\r?\n\|[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|[ \t]*\r?\n((?:\|.*\|[ \t]*\r?\n?)+)/gm;

    return html.replace(tableBlockRegex, (_match, headerRow: string, bodyRows: string) => {
      const headers = headerRow
        .split('|')
        .map((h) => h.trim())
        .filter((h) => h.length > 0);

      const rows = bodyRows
        .trim()
        .split('\n')
        .map((r) => r.trim())
        .filter((r) => r.length > 0)
        .map((row) =>
          row
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => c.trim())
        );

      const theadHtml = `<thead><tr>${headers
        .map(
          (h) =>
            `<th class="border border-glassBorder bg-white/5 text-slate-100 font-semibold px-3 py-2 text-left whitespace-nowrap">${h}</th>`
        )
        .join('')}</tr></thead>`;

      const tbodyHtml = `<tbody>${rows
        .map(
          (cells) =>
            `<tr>${cells.map((c) => `<td class="border border-glassBorder px-3 py-2 text-left align-top">${c}</td>`).join('')}</tr>`
        )
        .join('')}</tbody>`;

      return `<div class="overflow-x-auto my-2"><table class="w-full text-xs border-collapse">${theadHtml}${tbodyHtml}</table></div>\n`;
    });
  }

  /**
   * Wraps a block of consecutive markdown list lines (all bullets or all
   * numbered) in a real <ul>/<ol> so ordered lists get their own counter
   * instead of continuing the implicit item count from whatever <li>s
   * (e.g. a preceding bullet list) came before them on the page.
   */
  private renderListBlock(block: string, markerPrefix: RegExp, tag: 'ul' | 'ol', styleClass: string): string {
    const items = block
      .trim()
      .split('\n')
      .map((line) => line.replace(markerPrefix, '').trim())
      .filter((line) => line.length > 0);

    const itemsHtml = items.map((item) => `<li class="text-slate-200">${item}</li>`).join('');
    return `<${tag} class="${styleClass} ml-4 space-y-1 my-2">${itemsHtml}</${tag}>\n`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
