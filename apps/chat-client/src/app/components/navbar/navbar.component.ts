import { Component, EventEmitter, Output, ChangeDetectionStrategy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { ChatService } from '../../services/chat.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './navbar.component.html',
})
export class NavbarComponent {
  @Output() toggleSidebar = new EventEmitter<void>();
  @Output() openSettings = new EventEmitter<void>();
  @Output() openAdmin = new EventEmitter<void>();

  // AuthService.logout() has existed all along but was never wired to any
  // UI control - there was genuinely no way to sign out of this app.
  public isProfileMenuOpen = false;

  // Brief confirmation shown next to the Share button when
  // shareActiveThread() fell back to the clipboard (no native share sheet
  // gives its own confirmation there, unlike the OS sheet).
  public shareFeedback = signal<string | null>(null);
  private shareFeedbackTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    public authService: AuthService,
    public chatService: ChatService
  ) {}

  public toggleProfileMenu(): void {
    this.isProfileMenuOpen = !this.isProfileMenuOpen;
  }

  public signOut(): void {
    this.isProfileMenuOpen = false;
    this.authService.logout();
  }

  public hasShareableChat(): boolean {
    return (this.chatService.activeThread()?.messages || []).some((m) => m.role === 'user');
  }

  public async shareChat(): Promise<void> {
    const result = await this.chatService.shareActiveThread();
    if (result === 'copied') {
      this.flashShareFeedback('Copied to clipboard');
    } else if (result === 'unavailable') {
      this.flashShareFeedback("Couldn't share this chat");
    }
    // 'shared' and 'cancelled' need no feedback here - the OS share sheet
    // already gave its own confirmation, or the user just closed it.
  }

  private flashShareFeedback(message: string): void {
    if (this.shareFeedbackTimeout) clearTimeout(this.shareFeedbackTimeout);
    this.shareFeedback.set(message);
    this.shareFeedbackTimeout = setTimeout(() => this.shareFeedback.set(null), 2000);
  }
}
