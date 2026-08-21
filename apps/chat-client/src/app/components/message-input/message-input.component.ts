import { Component, HostListener, ChangeDetectionStrategy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AIModelType } from '@chat-monorepo/shared';
import { ChatService } from '../../services/chat.service';
import { ProjectService } from '../../services/project.service';

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
export class MessageInputComponent {
  public messageText = '';
  public isModelDropdownOpen = false;

  public availableModels = computed(() => this.chatService.availableModels());

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

  getModelDisplayName(): string {
    const active = this.chatService.selectedModel();
    const model = this.availableModels().find((m) => m.id === active);
    return model ? model.name : (active || 'Gemini Flash');
  }

  selectModel(id: string): void {
    this.chatService.setModel(id as AIModelType);
    this.isModelDropdownOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.model-selector')) {
      this.isModelDropdownOpen = false;
    }
  }
}
