import { Component, ElementRef, ViewChild, AfterViewChecked, effect, signal, SecurityContext, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { ChatService } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';

marked.setOptions({ gfm: true, breaks: true });

@Component({
  selector: 'app-chat-window',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.Eager,
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

  // Which message's "Copied" confirmation is currently showing, if any.
  public copiedMessageId = signal<string | null>(null);
  private copiedResetTimeout: ReturnType<typeof setTimeout> | null = null;

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
   * Copies a message's raw source (not the rendered HTML) to the clipboard,
   * matching ChatGPT/Gemini's copy behavior, and briefly shows a "Copied"
   * confirmation on that message's button.
   */
  public async copyMessage(id: string, content: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(content);
    } catch (e) {
      console.error('[ChatWindow] Copy to clipboard failed:', e);
      return;
    }

    if (this.copiedResetTimeout) {
      clearTimeout(this.copiedResetTimeout);
    }
    this.copiedMessageId.set(id);
    this.copiedResetTimeout = setTimeout(() => {
      this.copiedMessageId.set(null);
      this.copiedResetTimeout = null;
    }, 2000);
  }

  /**
   * Formats raw Markdown into sanitized, safe HTML for rich visual
   * rendering. Uses `marked` (GFM parser: full heading/table/list/
   * blockquote/code support) then `DOMPurify` to strip anything
   * executable before it ever reaches [innerHTML] - Angular's own
   * built-in sanitizer still runs on top of that as a second layer,
   * since this returns a plain string rather than a bypassed SafeHtml.
   */
  public renderMarkdown(content: string): string {
    if (!content) return '';
    const rawHtml = marked.parse(content, { async: false }) as string;
    const cleanHtml = DOMPurify.sanitize(rawHtml);
    return this.sanitizer.sanitize(SecurityContext.HTML, cleanHtml) ?? '';
  }

  public getUserDisplayName(): string {
    return this.authService.userSignal()?.displayName || 'You';
  }

  public getUserPhotoURL(): string | null {
    return this.authService.userSignal()?.photoURL || null;
  }

  public getUserInitial(): string {
    const name = this.authService.userSignal()?.displayName;
    return name ? name.charAt(0).toUpperCase() : 'U';
  }

  /** Opens a generated image full-size in a new tab (works for both data: URIs and real URLs). */
  public openImage(imageUrl: string): void {
    window.open(imageUrl, '_blank', 'noopener');
  }

  /**
   * Re-scrolls to bottom once an async image finishes loading. Images grow
   * the container's scrollHeight only after their own network/decode
   * completes, which happens after ngAfterViewChecked's scroll already ran
   * - without this, a generated image (or any late-loading content) is left
   * cut off below the fold even though "auto-scroll" fired on schedule.
   */
  public onContentLoad(): void {
    if (this.shouldAutoScroll) {
      this.scrollToBottom();
    }
  }
}
