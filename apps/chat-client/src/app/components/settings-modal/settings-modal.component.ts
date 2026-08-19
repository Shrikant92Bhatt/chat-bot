import { Component, EventEmitter, Output, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatService } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';

/**
 * The "Storage" tab (GCS bucket size/cost) was removed from here - that view
 * is admin-facing operational data, not an end-user setting, and it now lives
 * in the separate admin-analytics app behind the admin-only
 * GET /api/v1/admin/storage. The capability moved; it was not dropped.
 *
 * The backend's GET /api/chat/storage/metrics route is intentionally left in
 * place: it is still a valid authenticated endpoint and removing it would be
 * an unrelated breaking API change.
 */
@Component({
  selector: 'app-settings-modal',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './settings-modal.component.html',
})
export class SettingsModalComponent {
  @Output() closeModal = new EventEmitter<void>();

  public activeTab = signal<'general' | 'diagnostics'>('general');

  constructor(
    public chatService: ChatService,
    public authService: AuthService
  ) {}

  setTab(tab: 'general' | 'diagnostics') {
    this.activeTab.set(tab);
  }
}
