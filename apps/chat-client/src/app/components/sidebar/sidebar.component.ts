import { Component, EventEmitter, Input, Output, ChangeDetectionStrategy, signal, computed } from '@angular/core';
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

  /**
   * Client-side filter over already-loaded thread titles - no backend
   * search endpoint exists (see chat.service.ts), so this narrows
   * chatService.threads() in place rather than querying anything.
   */
  public searchQuery = signal<string>('');

  public filteredThreads = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    const threads = this.chatService.threads();
    if (!query) return threads;
    return threads.filter((t) => (t.title || 'New Chat').toLowerCase().includes(query));
  });

  constructor(public chatService: ChatService, public projectService: ProjectService) {}

  public onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchQuery.set(target.value);
  }

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
