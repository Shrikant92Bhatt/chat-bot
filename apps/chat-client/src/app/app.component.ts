import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from './components/navbar/navbar.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { ChatWindowComponent } from './components/chat-window/chat-window.component';
import { MessageInputComponent } from './components/message-input/message-input.component';
import { SessionExpiredModalComponent } from './components/session-expired-modal/session-expired-modal.component';
import { LoginErrorToastComponent } from './components/login-error-toast/login-error-toast.component';
import { SettingsModalComponent } from './components/settings-modal/settings-modal.component';
import { ProjectsModalComponent } from './components/projects-modal/projects-modal.component';
import { AdminDashboardComponent } from '@chat-monorepo/admin-analytics';
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
    ProjectsModalComponent,
    AdminDashboardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './app.component.html',
})
export class AppComponent {
  public isSettingsOpen = false;
  public isProjectsOpen = false;

  // Entry point visibility only - never the real authorization boundary.
  // Every admin API call independently re-checks the role server-side (see
  // requireAdmin), so a stale/wrong client-side role here can hide or show
  // the button but can never actually grant access.
  public isAdminViewOpen = false;

  public get canSeeAdminEntry(): boolean {
    return this.authService.userSignal()?.role === 'admin';
  }

  public openAdminView(): void {
    this.isAdminViewOpen = true;
  }

  public closeAdminView(): void {
    this.isAdminViewOpen = false;
  }

  public openSettings() {
    this.isSettingsOpen = true;
  }

  public closeSettings() {
    this.isSettingsOpen = false;
  }

  public openProjects() {
    this.isProjectsOpen = true;
  }

  public closeProjects() {
    this.isProjectsOpen = false;
  }
  // Matches the `lg:` breakpoint the sidebar/backdrop templates key off of -
  // keeps the sidebar as a full overlay (not sharing width with the chat)
  // on phones and most tablets, not just narrow phone widths.
  private static readonly MOBILE_BREAKPOINT_PX = 1024;

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
