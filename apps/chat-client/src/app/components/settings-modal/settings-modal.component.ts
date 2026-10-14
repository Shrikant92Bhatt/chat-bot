import { Component, EventEmitter, Input, OnInit, Output, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';
import { ConnectorsPanelComponent } from '../connectors-panel/connectors-panel.component';

export type SettingsTab = 'general' | 'personalize' | 'connectors' | 'diagnostics';

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
  imports: [CommonModule, FormsModule, ConnectorsPanelComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './settings-modal.component.html',
})
export class SettingsModalComponent implements OnInit {
  @Output() closeModal = new EventEmitter<void>();
  /** Tab to open on (e.g. 'connectors' after an OAuth round-trip). */
  @Input() initialTab: SettingsTab = 'general';
  /** One-off message for the Connectors tab (OAuth result). */
  @Input() connectorNotice: { kind: 'success' | 'error'; message: string } | null = null;

  public activeTab = signal<SettingsTab>('general');

  // Draft text for the "About you" textarea ([(ngModel)] needs a plain
  // property, not a signal) - kept separate from chatService.aboutMe (the
  // last-saved value) so navigating away without saving doesn't silently
  // persist an in-progress edit.
  public aboutMeDraft = '';
  public profileSaved = signal<boolean>(false);
  private savedResetTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public chatService: ChatService,
    public authService: AuthService
  ) {
    this.aboutMeDraft = this.chatService.aboutMe();
  }

  ngOnInit(): void {
    this.activeTab.set(this.initialTab);
  }

  setTab(tab: SettingsTab) {
    this.activeTab.set(tab);
    if (tab === 'personalize') {
      this.aboutMeDraft = this.chatService.aboutMe();
    }
  }

  public async saveProfile(): Promise<void> {
    const ok = await this.chatService.saveProfile(this.aboutMeDraft);
    if (!ok) return;

    if (this.savedResetTimeout) clearTimeout(this.savedResetTimeout);
    this.profileSaved.set(true);
    this.savedResetTimeout = setTimeout(() => this.profileSaved.set(false), 2000);
  }
}
