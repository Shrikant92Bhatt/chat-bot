import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from './components/navbar/navbar.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { ChatWindowComponent } from './components/chat-window/chat-window.component';
import { MessageInputComponent } from './components/message-input/message-input.component';
import { SessionExpiredModalComponent } from './components/session-expired-modal/session-expired-modal.component';
import { LoginErrorToastComponent } from './components/login-error-toast/login-error-toast.component';
import { SettingsModalComponent } from './components/settings-modal/settings-modal.component';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    NavbarComponent,
    SidebarComponent,
    ChatWindowComponent,
    MessageInputComponent,
    SessionExpiredModalComponent,
    LoginErrorToastComponent,
    SettingsModalComponent,
  ],
  templateUrl: './app.component.html',
})
export class AppComponent {
  public isSettingsOpen = false;

  public openSettings() {
    this.isSettingsOpen = true;
  }

  public closeSettings() {
    this.isSettingsOpen = false;
  }
  // Matches the `md:` breakpoint the sidebar/backdrop templates key off of.
  private static readonly MOBILE_BREAKPOINT_PX = 768;

  // Default closed on phone-width viewports so the sidebar doesn't cover
  // the whole chat on first load; still defaults open on desktop.
  public isSidebarOpen = window.innerWidth >= AppComponent.MOBILE_BREAKPOINT_PX;

  constructor(public authService: AuthService) {}

  public closeSidebarOnMobile(): void {
    if (window.innerWidth < AppComponent.MOBILE_BREAKPOINT_PX) {
      this.isSidebarOpen = false;
    }
  }
}
