import { Component, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AIModelType, SELECTABLE_MODELS } from '@chat-monorepo/shared';
import { ChatService } from '../../services/chat.service';

@Component({
  selector: 'app-message-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './message-input.component.html',
})
export class MessageInputComponent {
  public messageText = '';
  public isModelDropdownOpen = false;

  public availableModels = SELECTABLE_MODELS;

  constructor(public chatService: ChatService) {}

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
    if (!this.messageText.trim() || this.chatService.isStreaming()) return;
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

  getModelDisplayName(): string {
    const active = this.chatService.selectedModel();
    const model = this.availableModels.find((m) => m.id === active);
    return model ? model.name : 'Gemini Flash';
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
