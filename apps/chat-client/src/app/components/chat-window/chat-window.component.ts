import { Component, ElementRef, ViewChild, AfterViewChecked, effect, signal, ChangeDetectionStrategy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { marked } from 'marked';
import { ChatService } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';
import { ActionDispatcherService } from '../../services/action-dispatcher.service';
import { UiBlockComponent } from '../ui-block/ui-block.component';
import { ResearchPanelComponent } from '../research-panel/research-panel.component';
import { ChatMessage, MessageFeedbackRating, ResearchTrace } from '@chat-monorepo/shared';
import { configureMarkedForCodeBlocks } from '../../shared/markdown/code-block-renderer';
import { handleCodeBlockClick } from '../../shared/markdown/code-block-interactions';
import { sanitizeGeneratedHtml } from '../../shared/markdown/sanitize-html';
import { renderCitationMarkers } from '../../shared/markdown/citation-markers';
import { handleCitationMarkerClick } from '../../shared/markdown/citation-marker-interactions';

configureMarkedForCodeBlocks();

/** One empty-state capability chip: a label plus the starter prompt it drops into the composer. */
interface CapabilityChip {
  label: string;
  icon: string;
  prompt: string;
}

@Component({
  selector: 'app-chat-window',
  standalone: true,
  imports: [CommonModule, UiBlockComponent, ResearchPanelComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './chat-window.component.html',
  // The host element sits inside a flex-col (<main>) alongside
  // <app-message-input>. Angular components default to display:inline, which
  // doesn't participate in flex sizing — the chat area overflows behind the
  // input bar on mobile because flex can't constrain an inline child's height.
  // min-height:0 lets it shrink below its content size so overflow-y-auto on
  // the inner scroll container actually kicks in.
  host: {
    style: 'display:flex; flex-direction:column; min-height:0; overflow:hidden; flex:1 1 0%',
  },
})
export class ChatWindowComponent implements AfterViewChecked {
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef<HTMLElement>;

  /**
   * Empty-state starter chips. Deliberately a short, fixed list naming only
   * capabilities the backend actually implements (see
   * .agents/PROJECT_CONTEXT.md - RAG document upload, web_search,
   * get_stock_quote, code_interpreter) - not a dashboard, just a few
   * clickable examples. Clicking one fills the composer via
   * ChatService.prefillComposer() so the user can still review/edit before
   * sending, same as typing.
   */
  public readonly capabilityChips: CapabilityChip[] = [
    {
      label: 'Analyze a document',
      icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      prompt: "I'm about to attach a document — once it's uploaded, please summarize the key points and flag anything that looks important.",
    },
    {
      label: 'Search the web',
      icon: 'M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z',
      prompt: 'Search the web for the latest news on ',
    },
    {
      label: 'Check a stock price',
      icon: 'M3 3v18h18M7 15l4-4 3 3 5-6',
      prompt: "What's the current stock price and today's change for ",
    },
    {
      label: 'Write code',
      icon: 'M8 9l-3 3 3 3m8-6l3 3-3 3M13 6l-2 12',
      prompt: 'Write a function that ',
    },
  ];

  /** Fills the composer with a chip's starter prompt without sending it. */
  public useCapabilityChip(chip: CapabilityChip): void {
    this.chatService.prefillComposer(chip.prompt);
  }

  // Only auto-scroll while the user is already at (or very near) the
  // bottom, so scrolling up to read earlier messages during a stream
  // doesn't keep getting yanked back down on every change-detection pass.
  //
  // Kept deliberately tight (not a few dozen px): onUserScrollIntent()
  // disables auto-follow the instant a wheel/touch gesture starts, but
  // onScroll() re-enables it whenever the resulting position is "close
  // enough" to the bottom - a generous threshold here means even a single
  // small scroll-up tick (common on trackpads/precision mice, which often
  // move well under 20-30px per event) still lands inside the "close
  // enough" window and gets immediately re-armed, cancelling the very
  // gesture that just tried to disable it. That's what "scroll up once
  // does nothing, twice works" looks like: the first tick's disable gets
  // undone before it's visible, the second tick finally moves far enough
  // to stay outside the window. A tight threshold means resuming
  // auto-follow requires actually reaching the bottom, not just
  // approaching it - standard behavior for chat UIs.
  private shouldAutoScroll = true;
  private readonly bottomThresholdPx = 8;

  // Mirrors shouldAutoScroll as a signal purely so the template can show a
  // "New messages" jump button while the user has scrolled away mid-stream -
  // shouldAutoScroll itself stays a plain field so the imperative
  // ngAfterViewChecked scroll logic above isn't tied to Angular's reactivity.
  public isScrolledAway = signal(false);

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

  // Which message's share fell back to clipboard/failed, and what to say -
  // only set for those two cases, same as navbar's shareChat(): the OS
  // share sheet already gives its own confirmation when it succeeds.
  public shareFeedback = signal<{ id: string; message: string } | null>(null);
  private shareFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public chatService: ChatService,
    public authService: AuthService,
    public actionDispatcher: ActionDispatcherService,
    private sanitizer: DomSanitizer
  ) {
    effect(() => {
      const threadId = this.chatService.activeThreadId();
      const count = this.chatService.activeMessages().length;

      if (threadId !== this.previousThreadId || count > this.previousMessageCount) {
        this.shouldAutoScroll = true;
        this.isScrolledAway.set(false);
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

  // First fix (see git history) tried to tell "our own programmatic scroll"
  // apart from "a real user scroll" by flagging our own scrollTop write and
  // ignoring the 'scroll' event it triggers. That works once the view is
  // settled, but falls apart the moment content is genuinely growing (i.e.
  // mid-stream): every arriving token makes scrollToBottom() a REAL scroll,
  // not a no-op, so the flag gets re-armed on every single token - during
  // active streaming, a user's manual scroll-up basically never wins the
  // race against the next token's auto-scroll. That's the case a real user
  // hits constantly (scrolling up *while* a reply is still being generated)
  // and the one the first fix never actually tested.
  //
  // Correct fix: stop trying to infer intent from the 'scroll' event at all.
  // Listen for the actual user-input events that start a scroll gesture
  // (wheel / touchstart) and treat those as the sole authority for "the user
  // wants manual control now" - decided the instant input happens, with no
  // dependency on distinguishing it from a programmatic scroll afterward.
  // onScroll() is now only used to RE-ENABLE auto-follow once the user
  // scrolls back down to the bottom themselves.
  onUserScrollIntent(): void {
    this.shouldAutoScroll = false;
    if (this.chatService.isStreaming()) this.isScrolledAway.set(true);
  }

  onScroll(): void {
    const el = this.scrollContainer.nativeElement;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom < this.bottomThresholdPx) {
      this.shouldAutoScroll = true;
      this.isScrolledAway.set(false);
    }
  }

  private scrollToBottom(): void {
    const el = this.scrollContainer?.nativeElement;
    if (!el) return;
    if (el.scrollTop >= el.scrollHeight - el.clientHeight - 1) return;
    el.scrollTop = el.scrollHeight;
  }

  /** Jumps back to the latest message - the "↓ New messages" button's click handler. */
  public jumpToLatest(): void {
    this.shouldAutoScroll = true;
    this.isScrolledAway.set(false);
    this.scrollToBottom();
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
   * The research trace to show for a message: the live one while this
   * message is the one being streamed, otherwise whatever was pinned to it
   * when its turn finished. Returns null when there is nothing to show, so
   * the panel stays out of the way on ordinary turns.
   */
  public researchTraceFor(msg: ChatMessage): ResearchTrace | null {
    if (msg.role !== 'assistant') return null;
    if (this.chatService.isStreaming() && this.isLastMessage(msg)) {
      return this.chatService.activeResearchTrace() ?? msg.research ?? null;
    }
    return msg.research ?? null;
  }

  /** True for the final message of the active thread. */
  public isLastMessage(msg: ChatMessage): boolean {
    const messages = this.chatService.activeThread()?.messages ?? [];
    return messages.length > 0 && messages[messages.length - 1].id === msg.id;
  }

  /**
   * Label for a source chip. Prefers the publisher's own title; falls back
   * to the bare hostname, which is far more scannable than a full URL when
   * an answer cites half a dozen pages.
   */
  public sourceLabel(source: { title?: string; url?: string }): string {
    const title = source.title?.trim();
    if (title) return title;
    if (!source.url) return 'Source';
    try {
      return new URL(source.url).hostname.replace(/^www\./, '');
    } catch {
      return source.url;
    }
  }

  /** Get favicon URL for a source domain using DuckDuckGo's icon service. */
  public getFaviconUrl(source: { title?: string; url?: string }): string | null {
    if (!source.url) return null;
    try {
      const hostname = new URL(source.url).hostname;
      return `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
    } catch {
      return null;
    }
  }

  /** Shares a single response via the device's native share sheet, falling back to clipboard. */
  public async shareMessage(id: string, content: string): Promise<void> {
    const result = await this.chatService.shareMessage(content);
    if (result === 'copied') {
      this.flashShareFeedback(id, 'Copied to clipboard');
    } else if (result === 'unavailable') {
      this.flashShareFeedback(id, "Couldn't share this");
    }
    // 'shared' and 'cancelled' need no feedback here - the OS share sheet
    // already gave its own confirmation, or the user just closed it.
  }

  private flashShareFeedback(id: string, message: string): void {
    if (this.shareFeedbackTimeout) clearTimeout(this.shareFeedbackTimeout);
    this.shareFeedback.set({ id, message });
    this.shareFeedbackTimeout = setTimeout(() => this.shareFeedback.set(null), 2000);
  }

  /** This message's current thumbs up/down rating, or null if unrated. */
  public ratingFor(msg: ChatMessage): MessageFeedbackRating | null {
    return this.chatService.messageFeedback()[msg.id] ?? null;
  }

  /**
   * Rates (or, clicked again, un-rates) a response. No-ops without an
   * active thread id, which shouldn't happen for a rendered assistant
   * message in practice, but keeps this safe against that edge case rather
   * than sending a malformed request.
   */
  public rateMessage(msg: ChatMessage, rating: MessageFeedbackRating): void {
    const threadId = this.chatService.activeThreadId();
    if (!threadId) return;
    void this.chatService.rateMessage(threadId, msg.id, rating);
  }

  /**
   * Formats raw Markdown into sanitized, safe HTML for rich visual
   * rendering. Uses `marked` (GFM parser: full heading/table/list/
   * blockquote/code support) then `DOMPurify` to strip anything
   * executable before it ever reaches [innerHTML] - Angular's own
   * built-in sanitizer still runs on top of that as a second layer,
   * since this returns a plain string rather than a bypassed SafeHtml.
   *
   * `sourceCount` (defaults to 0 - plain-text messages and every UI
   * component/image-only reply that never calls this with a real count
   * behave exactly as before) is `msg.sources.length` for the message being
   * rendered; `renderCitationMarkers()` runs last, after sanitization, and
   * turns an in-range `[n]` into a clickable chip - see that module's doc
   * comment for exactly what is and isn't guaranteed about it.
   */
  public renderMarkdown(content: string, sourceCount = 0): string {
    if (!content) return '';
    const rawHtml = marked.parse(content, { async: false }) as string;
    const safeHtml = sanitizeGeneratedHtml(rawHtml, this.sanitizer);
    return renderCitationMarkers(safeHtml, { sourceCount });
  }

  /**
   * Delegated click handler for the Copy/Wrap/line-number buttons that
   * `configureMarkedForCodeBlocks()` injects into fenced code blocks inside
   * `renderMarkdown()`'s output, and for the inline citation marker chips
   * `renderCitationMarkers()` injects into that same output. Both live
   * inside `[innerHTML]` content and can't carry Angular `(click)` bindings
   * of their own - see `handleCodeBlockClick`'s and
   * `handleCitationMarkerClick`'s doc comments. Bound on the container that
   * wraps every message's rendered Markdown (see
   * chat-window.component.html), so one listener covers every code block
   * and citation marker in the thread; each handler is a no-op when the
   * click wasn't inside its own kind of target, so the two can't interfere.
   */
  @HostListener('click', ['$event'])
  public onMessagesClick(event: Event): void {
    handleCodeBlockClick(event);
    handleCitationMarkerClick(event);
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
