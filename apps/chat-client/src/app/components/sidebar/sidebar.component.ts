import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatService } from '../../services/chat.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './sidebar.component.html',
})
export class SidebarComponent {
  @Input() isOpen = true;
  @Output() threadSelected = new EventEmitter<void>();
  @Output() settingsClicked = new EventEmitter<void>();

  constructor(public chatService: ChatService) {}

  public selectThread(threadId: string): void {
    this.chatService.selectThread(threadId);
    this.threadSelected.emit();
  }

  public createNewThread(): void {
    this.chatService.createNewThread();
    this.threadSelected.emit();
  }
}
