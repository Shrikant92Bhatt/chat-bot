import { Component, HostListener, ChangeDetectionStrategy, OnDestroy, computed, effect, isDevMode, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AIModelType,
  SelectableModel,
  validateVideoGenerationRequest,
  getOpenRouterVideoCapabilities,
  VideoGenerationValidationResult,
} from '@chat-monorepo/shared';
import { ChatService } from '../../services/chat.service';
import { ProjectService } from '../../services/project.service';

// The Web Speech API has no first-party TS lib entry (like `google` in
// auth.service.ts, this is a browser global with no bundled types) - Chrome/
// Edge/Safari expose it as `webkitSpeechRecognition`, only very recent
// browsers as the unprefixed `SpeechRecognition`. Firefox has neither, so
// dictation-related methods below all check speechSupported first.
function getSpeechRecognitionCtor(): any {
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
}

@Component({
  selector: 'app-message-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './message-input.component.html',
  // Must be display:block (not the default inline) so it sizes correctly as a
  // flex-col child in <main> and doesn't overlap the chat-window on mobile.
  host: { style: 'display:block; flex-shrink:0' },
})
export class MessageInputComponent implements OnDestroy {
  @ViewChild('messageTextarea') private messageTextarea?: ElementRef<HTMLTextAreaElement>;

  public messageText = '';
  public isModelDropdownOpen = false;
  private highlightedModelId: string | null = null;


  // Dictation (speech-to-text). speechSupported is resolved once at
  // construction - the API availability doesn't change during a session, so
  // there's no need to re-check it on every template render.
  public readonly speechSupported: boolean = !!getSpeechRecognitionCtor();
  public isListening = false;
  private recognition: any = null;
  // messageText as it was the moment dictation started - each recognition
  // result event replaces everything typed/spoken *during this dictation
  // session* by re-deriving the full transcript from event.results (the
  // Web Speech API's own running total for the session), so this baseline
  // is what anchors that onto whatever was already in the box.
  private dictationBaseText = '';

  public availableModels = computed(() => this.chatService.availableModels());
  /** availableModels() grouped by provider, in first-seen order, for the dropdown. */
  public groupedModels = computed(() => this.groupModelsByProvider(this.availableModels()));
  /** availableVideoModels() grouped by provider, same shape as groupedModels() above. */
  public videoModelGroups = computed(() => this.groupModelsByProvider(this.chatService.availableVideoModels()));

  /** Name of the project this conversation is scoped to, or null. */
  public activeProjectName = computed(() =>
    this.projectService.getProjectName(this.chatService.activeProjectId())
  );

  // The message id the composer's current draft was last seeded from, so
  // the edit-seeding effect below only overwrites messageText on the edge
  // transition into (or between) edit sessions - not on every unrelated
  // activeMessages() change while an edit is already open, which would
  // clobber whatever the user has typed since.
  private lastSeededEditId: string | null = null;

  constructor(public chatService: ChatService, private projectService: ProjectService) {
    // Consumes a starter prompt set by the empty-state capability chips
    // (chat-window.component, via ChatService.prefillComposer) - populates
    // the box and focuses it for review/edit, same as anything the user
    // types themselves; never auto-sent. allowSignalWrites is required
    // because the effect clears the very signal it reads, to make this
    // one-shot rather than re-firing on every future change.
    effect(
      () => {
        const draft = this.chatService.composerDraft();
        if (draft === null) return;
        this.messageText = draft;
        this.chatService.composerDraft.set(null);
        queueMicrotask(() => {
          this.messageTextarea?.nativeElement.focus();
          this.autoGrow();
        });
      },
      { allowSignalWrites: true }
    );

    // Seeds the composer when an edit session starts (or switches to a
    // different message), and clears it if an edit session ends from
    // outside the composer (e.g. the active thread changed under it) -
    // send()/cancelEdit() already clear messageText themselves for the
    // in-composer paths, so the else-branch only fires for that external case.
    effect(() => {
      const editingId = this.chatService.editingMessageId();
      if (editingId && editingId !== this.lastSeededEditId) {
        const msg = this.chatService.activeMessages().find((m) => m.id === editingId);
        this.messageText = msg?.content ?? this.messageText;
        this.lastSeededEditId = editingId;
      } else if (!editingId && this.lastSeededEditId) {
        this.messageText = '';
        this.lastSeededEditId = null;
      }
      queueMicrotask(() => this.autoGrow());
    });
  }

  /**
   * Grows the textarea to fit its content, capped at whatever the
   * template's own `max-h-32 sm:max-h-36` Tailwind class currently resolves
   * to (128px on mobile, 144px on sm:+) - read live via getComputedStyle
   * rather than a hardcoded constant, which previously only matched the
   * desktop value. That mismatch meant on mobile the box tried to grow past
   * what CSS actually allowed (CSS max-height always wins over an inline
   * height), so the last few lines before the internal scroll kicked in
   * rendered cramped/inconsistently. Reading the real value here means this
   * can never drift out of sync with the template's breakpoints again.
   * Bound to (input) for direct typing/paste; called manually after every
   * programmatic messageText change (draft prefill, edit seeding, dictation,
   * send/cancel clearing it) since those don't fire a DOM input event.
   */
  autoGrow(): void {
    const el = this.messageTextarea?.nativeElement;
    if (!el) return;
    const maxHeight = parseFloat(getComputedStyle(el).maxHeight) || 144;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
  }

  onKeydown(event: KeyboardEvent) {
    // While streaming, send() is a no-op (see below) - previously this still
    // called preventDefault(), silently swallowing the Enter keystroke
    // instead of either sending or inserting a newline. Falling through to
    // the textarea's default newline behavior instead keeps Enter useful.
    if (event.key === 'Enter' && !event.shiftKey && !this.chatService.isStreaming()) {
      event.preventDefault();
      this.send();
    }
  }

  /** Escape cancels an in-progress edit without sending it. */
  onEscapeKey(): void {
    if (this.chatService.editingMessageId()) {
      this.cancelEdit();
    }
  }

  /** Leaves edit mode and clears whatever draft was in the composer. */
  cancelEdit(): void {
    this.chatService.cancelEditingMessage();
    this.messageText = '';
    this.lastSeededEditId = null;
    queueMicrotask(() => this.autoGrow());
  }

  get placeholder(): string {
    const mode = this.chatService.chatMode();
    if (mode === 'image') return 'Describe an image you want to create...';
    if (mode === 'video') return 'Describe a video you want to create... (optionally attach reference images)';
    return 'Message NexusAI...';
  }

  send() {
    const hasText = !!this.messageText.trim();
    const hasAttachments = this.chatService.stagedAttachments().length > 0;
    if ((!hasText && !hasAttachments) || this.chatService.isStreaming()) return;
    this.stopDictation();
    const text = this.messageText;
    this.messageText = '';
    this.lastSeededEditId = null;
    queueMicrotask(() => this.autoGrow());

    if (this.chatService.editingMessageId()) {
      this.chatService.editLastUserMessage(text);
      return;
    }

    const mode = this.chatService.chatMode();
    if (mode === 'image') {
      this.chatService.generateImage(text);
    } else if (mode === 'video') {
      this.chatService.generateVideo(text);
    } else {
      this.chatService.sendMessage(text);
    }
  }

  setMode(mode: 'chat' | 'image' | 'video'): void {
    this.chatService.setChatMode(mode);
  }

  public isVideoModelDropdownOpen = false;

  getVideoModelDisplayName(): string {
    const active = this.chatService.selectedVideoModel();
    const model = this.chatService.availableVideoModels().find((m) => m.id === active);
    return model ? model.name : active;
  }

  selectVideoModel(id: string): void {
    this.chatService.setVideoModel(id);
    this.isVideoModelDropdownOpen = false;
  }

  toggleVideoModelDropdown(): void {
    this.isVideoModelDropdownOpen = !this.isVideoModelDropdownOpen;
  }

  /**
   * The exact same validateVideoGenerationRequest() the backend calls
   * before ever hitting OpenRouter (see apps/chat-api/src/llm/video-modes.ts) -
   * imported from the shared lib so this warning and the backend's actual
   * rejection can never disagree about the same set of attachments. Only
   * warns when the CURRENTLY selected model's capabilities genuinely can't
   * satisfy what's attached - never a blanket "video mode -> flag every
   * video" rule, and never triggered by image-only attachments regardless
   * of count (this is the exact scenario from the mobile bug report: 4
   * staged images must never produce this warning).
   */
  videoValidation = computed<VideoGenerationValidationResult>(() => {
    const staged = this.chatService.stagedAttachments();
    return validateVideoGenerationRequest({
      referenceImageUrls: staged.filter((a) => a.kind === 'image').map((a) => a.url),
      referenceVideoUrls: staged.filter((a) => a.kind === 'video').map((a) => a.url),
      capabilities: getOpenRouterVideoCapabilities(),
      modelName: this.getVideoModelDisplayName(),
    });
  });

  /**
   * Dev-only diagnostic: every staged attachment's actual classified kind +
   * MIME type, so a report like "the UI shows images but warns about video"
   * is immediately checkable from the browser itself - no need to guess or
   * reproduce on another device. isDevMode() is Angular's own dev/production
   * flag (true in `ng serve`, compiled out/false in a production build), so
   * this never renders for real users.
   */
  readonly showAttachmentDiagnostics = isDevMode();

  // Knowledge-base document types stay on the existing single-file RAG
  // upload path; anything else (jpg/png/mp4/...) goes to attachMedia()
  // instead, which stages it as a chat-message attachment (see
  // chat.service.ts). One button, one file picker, two destinations.
  private readonly DOCUMENT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.pdf'];

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];

    const mediaFiles: File[] = [];
    for (const file of files) {
      const isDocument = this.DOCUMENT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
      if (isDocument) {
        this.chatService.uploadDocument(file);
      } else {
        mediaFiles.push(file);
      }
    }
    if (mediaFiles.length > 0) {
      this.chatService.attachMedia(mediaFiles);
    }

    // Reset so selecting the same file(s) again still fires a change event.
    input.value = '';
  }

  /**
   * Toggles browser speech-to-text dictation into the message textarea.
   * continuous+interimResults so the API keeps listening across pauses and
   * streams partial results immediately; onresult re-derives the FULL
   * transcript-so-far from event.results (the API's own running total for
   * this session) on every event, rather than trying to append individual
   * results, since interim results get revised in place as recognition
   * improves its guess - diffing them would double up or drop words.
   */
  toggleDictation(): void {
    if (this.isListening) {
      this.stopDictation();
    } else {
      this.startDictation();
    }
  }

  private startDictation(): void {
    if (!this.speechSupported || this.isListening) return;

    const RecognitionCtor = getSpeechRecognitionCtor();
    const recognition = new RecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      const needsSpace = !!this.dictationBaseText && !this.dictationBaseText.endsWith(' ') && !!transcript;
      this.messageText = this.dictationBaseText + (needsSpace ? ' ' : '') + transcript;
      queueMicrotask(() => this.autoGrow());
    };

    recognition.onerror = (event: any) => {
      console.error('[MessageInput] Speech recognition error:', event.error);
      this.isListening = false;
    };

    recognition.onend = () => {
      // Fires both when stop() is called and when the browser ends the
      // session on its own (e.g. extended silence) - either way, the mic
      // button shouldn't keep showing "listening" with nothing behind it.
      this.isListening = false;
    };

    this.dictationBaseText = this.messageText;
    this.recognition = recognition;
    this.isListening = true;
    recognition.start();
  }

  private stopDictation(): void {
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
    }
    this.isListening = false;
  }

  ngOnDestroy(): void {
    this.stopDictation();
  }

  getModelDisplayName(): string {
    const active = this.chatService.selectedModel();
    const model = this.availableModels().find((m) => m.id === active);
    return model ? model.name : (active || 'Gemini Flash');
  }

  selectModel(id: string): void {
    this.chatService.setModel(id as AIModelType);
    this.isModelDropdownOpen = false;
    this.highlightedModelId = null;
  }

  toggleModelDropdown(): void {
    if (this.isModelDropdownOpen) {
      this.isModelDropdownOpen = false;
      this.highlightedModelId = null;
    } else {
      this.isModelDropdownOpen = true;
      this.highlightedModelId = this.chatService.selectedModel();
    }
  }

  onModelDropdownKeydown(event: KeyboardEvent): void {
    if (!this.isModelDropdownOpen) return;

    const allModels = this.groupedModels().flatMap((g) => g.models);
    const enabledModels = allModels.filter((m) => !m.usage?.disabled);

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (enabledModels.length === 0) return;

      const currentIndex = this.highlightedModelId
        ? enabledModels.findIndex((m) => m.id === this.highlightedModelId)
        : -1;

      let nextIndex: number;
      if (event.key === 'ArrowDown') {
        nextIndex = currentIndex < enabledModels.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : enabledModels.length - 1;
      }

      this.highlightedModelId = enabledModels[nextIndex].id;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (this.highlightedModelId) {
        this.selectModel(this.highlightedModelId);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.isModelDropdownOpen = false;
      this.highlightedModelId = null;
    }
  }

  isModelHighlighted(modelId: string): boolean {
    return this.highlightedModelId === modelId;
  }

  private groupModelsByProvider(models: SelectableModel[]): Array<{ provider: string; models: SelectableModel[] }> {
    const order: string[] = [];
    const byProvider = new Map<string, SelectableModel[]>();
    for (const m of models) {
      const provider = m.provider?.trim() || 'Other';
      if (!byProvider.has(provider)) {
        byProvider.set(provider, []);
        order.push(provider);
      }
      byProvider.get(provider)!.push(m);
    }
    return order.map((provider) => ({ provider, models: byProvider.get(provider)! }));
  }

  /**
   * Coarse token-cost tier for the dropdown badge, from completion pricing
   * (USD/1K tokens - the dominant cost driver, since replies run longer than
   * prompts). null when a model has no pricing data (badge is omitted).
   */
  tokenTier(model: SelectableModel): 'low' | 'medium' | 'high' | null {
    const cost = model.pricing?.completion ?? model.pricing?.prompt;
    if (cost == null) return null;
    if (cost <= 0.001) return 'low';
    if (cost <= 0.006) return 'medium';
    return 'high';
  }

  tokenTierLabel(tier: 'low' | 'medium' | 'high'): string {
    return tier === 'low' ? 'Low' : tier === 'medium' ? 'Med' : 'High';
  }

  tokenTierClass(tier: 'low' | 'medium' | 'high'): string {
    return tier === 'low'
      ? 'bg-emerald-500/15 text-emerald-400'
      : tier === 'medium'
      ? 'bg-amber-500/15 text-amber-400'
      : 'bg-accentRose/15 text-accentRose';
  }

  /** "resets in Xh"/"resets in Xm" for a disabled model's tooltip. */
  modelResetLabel(resetAt: number): string {
    return this.chatService.formatResetLabel(resetAt);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.model-selector')) {
      this.isModelDropdownOpen = false;
    }
    if (!target.closest('.video-model-selector')) {
      this.isVideoModelDropdownOpen = false;
    }
  }
}
