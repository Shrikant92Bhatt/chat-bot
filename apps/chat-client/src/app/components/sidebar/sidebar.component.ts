import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatService } from '../../services/chat.service';
import { ProjectService } from '../../services/project.service';

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
  @Output() projectsClicked = new EventEmitter<void>();

  constructor(public chatService: ChatService, public projectService: ProjectService) {}

  public selectThread(threadId: string): void {
    this.chatService.selectThread(threadId);
    this.threadSelected.emit();
  }

  public createNewThread(): void {
    this.chatService.createNewThread();
    this.threadSelected.emit();
  }

  /** Starts a conversation already scoped to a project. */
  public startProjectThread(projectId: string): void {
    this.chatService.createNewThread(projectId);
    this.threadSelected.emit();
  }

  public projectNameFor(projectId: string | null | undefined): string | null {
    return this.projectService.getProjectName(projectId);
  }
}
