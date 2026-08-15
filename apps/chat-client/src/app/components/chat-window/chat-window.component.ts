import { Component, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
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
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;

  constructor(
    public chatService: ChatService,
    public authService: AuthService,
    private sanitizer: DomSanitizer
  ) {}

  ngAfterViewChecked() {
    this.scrollToBottom();
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

    // 6. Bullet lists: * item or - item
    html = html.replace(/^[*-]\s+(.+)$/gm, '<li class="ml-4 list-disc text-slate-200">$1</li>');

    // 7. Line breaks
    html = html.replace(/\n/g, '<br/>');

    return this.sanitizer.bypassSecurityTrustHtml(html);
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
