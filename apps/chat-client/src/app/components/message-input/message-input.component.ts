import { Component, HostListener, ChangeDetectionStrategy, OnDestroy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AIModelType, SelectableModel } from '@chat-monorepo/shared';
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
  public messageText = '';
  public isModelDropdownOpen = false;

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

  /** Name of the project this conversation is scoped to, or null. */
  public activeProjectName = computed(() =>
    this.projectService.getProjectName(this.chatService.activeProjectId())
  );

  constructor(public chatService: ChatService, private projectService: ProjectService) {}

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  get placeholder(): string {
    return this.chatService.chatMode() === 'image' ? 'Describe an image you want to create...' : 'Message NexusAI...';
  }

  send() {
    const hasText = !!this.messageText.trim();
    const hasAttachments = this.chatService.stagedAttachments().length > 0;
    if ((!hasText && !hasAttachments) || this.chatService.isStreaming()) return;
    this.stopDictation();
    const text = this.messageText;
    this.messageText = '';

    if (this.chatService.chatMode() === 'image') {
      this.chatService.generateImage(text);
    } else {
      this.chatService.sendMessage(text);
    }
  }

  setMode(mode: 'chat' | 'image'): void {
    this.chatService.setChatMode(mode);
  }

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
  }
}
