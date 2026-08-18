import { Component, EventEmitter, Output, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatService } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';
import { getApiBaseUrl } from '../../core/runtime-config';

@Component({
  selector: 'app-settings-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './settings-modal.component.html',
})
export class SettingsModalComponent implements OnInit {
  @Output() closeModal = new EventEmitter<void>();
  
  public activeTab = signal<'general' | 'diagnostics' | 'storage'>('general');
  public storageMetrics = signal<any>(null);
  public loadingMetrics = signal(false);
  
  constructor(
    public chatService: ChatService,
    public authService: AuthService
  ) {}
  
  ngOnInit() {
    this.loadStorageMetrics();
  }
  
  async loadStorageMetrics() {
    this.loadingMetrics.set(true);
    try {
      const token = this.authService.getIdToken();
      const res = await fetch(`${getApiBaseUrl()}/api/chat/storage/metrics`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        this.storageMetrics.set(await res.json());
      }
    } catch (e) {
      console.error('[Settings] Failed to load storage metrics:', e);
    } finally {
      this.loadingMetrics.set(false);
    }
  }
  
  setTab(tab: 'general' | 'diagnostics' | 'storage') {
    this.activeTab.set(tab);
  }
}
