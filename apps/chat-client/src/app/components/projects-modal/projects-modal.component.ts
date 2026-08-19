import { ChangeDetectionStrategy, Component, EventEmitter, Output, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProjectService } from '../../services/project.service';
import { ChatService } from '../../services/chat.service';

/**
 * Projects workspace modal: list projects on the left, edit the selected
 * project's name/instructions and its knowledge-base files on the right,
 * and start a conversation scoped to it.
 */
@Component({
  selector: 'app-projects-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './projects-modal.component.html',
})
export class ProjectsModalComponent {
  @Output() closeModal = new EventEmitter<void>();

  public isCreating = signal<boolean>(false);
  public newProjectName = '';

  /** Local draft of the selected project's editable fields. */
  public draftName = '';
  public draftInstructions = '';
  public isSaving = signal<boolean>(false);
  public savedAt = signal<number | null>(null);

  constructor(public projectService: ProjectService, public chatService: ChatService) {
    // Reload the draft whenever a different project is selected, so edits
    // to one project never bleed into another.
    effect(
      () => {
        const project = this.projectService.selectedProject();
        this.draftName = project?.name ?? '';
        this.draftInstructions = project?.instructions ?? '';
        this.savedAt.set(null);
      },
      { allowSignalWrites: true }
    );
  }

  public select(projectId: string): void {
    this.projectService.selectProject(projectId);
    this.isCreating.set(false);
  }

  public startCreating(): void {
    this.isCreating.set(true);
    this.newProjectName = '';
  }

  public async confirmCreate(): Promise<void> {
    const name = this.newProjectName.trim();
    if (!name) return;
    const created = await this.projectService.createProject(name);
    if (created) {
      this.isCreating.set(false);
      this.newProjectName = '';
    }
  }

  public async save(): Promise<void> {
    const project = this.projectService.selectedProject();
    if (!project) return;
    this.isSaving.set(true);
    await this.projectService.updateProject(project.id, {
      name: this.draftName.trim() || project.name,
      instructions: this.draftInstructions,
    });
    this.isSaving.set(false);
    this.savedAt.set(Date.now());
  }

  public async remove(): Promise<void> {
    const project = this.projectService.selectedProject();
    if (!project) return;
    // Deliberately a native confirm: deleting a project also deletes its
    // ingested files, and this UI has no undo.
    if (!confirm(`Delete project "${project.name}" and its uploaded files?`)) return;
    await this.projectService.deleteProject(project.id);
  }

  public onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const project = this.projectService.selectedProject();
    if (file && project) {
      this.projectService.uploadFile(project.id, file);
    }
    input.value = '';
  }

  /** Opens a fresh conversation scoped to the selected project. */
  public startChatInProject(): void {
    const project = this.projectService.selectedProject();
    if (!project) return;
    this.chatService.createNewThread(project.id);
    this.closeModal.emit();
  }

  public formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString();
  }
}
