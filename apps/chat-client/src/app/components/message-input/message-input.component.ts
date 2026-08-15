import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../../services/chat.service';

@Component({
  selector: 'app-message-input',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './message-input.component.html',
})
export class MessageInputComponent {
  public messageText = '';

  constructor(public chatService: ChatService) {}

  onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  send() {
    if (!this.messageText.trim() || this.chatService.isStreaming()) return;
    const text = this.messageText;
    this.messageText = '';
    this.chatService.sendMessage(text);
  }
}
