import { Component, ChangeDetectionStrategy, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
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
export class AppComponent implements OnInit, OnDestroy {
  public isSettingsOpen = false;
  public isProjectsOpen = false;
  public isAdminViewOpen = false;
  public initialAdminView = 'overview';

  public get canSeeAdminEntry(): boolean {
    return this.authService.userSignal()?.role === 'admin';
  }

  ngOnInit(): void {
    const path = window.location.pathname;
    if (path.startsWith('/admin')) {
      this.isAdminViewOpen = true;
      if (path.includes('/emulator')) {
        this.initialAdminView = 'emulator';
      }
    }
  }

  ngOnDestroy(): void {
    // Cleanup happens via HostListener, no manual cleanup needed
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    const shouldBeOpen = window.innerWidth >= AppComponent.MOBILE_BREAKPOINT_PX;
    // Close sidebar when transitioning to mobile; open when transitioning to desktop
    if (!shouldBeOpen && this.isSidebarOpen) {
      this.isSidebarOpen = false;
    } else if (shouldBeOpen && !this.isSidebarOpen) {
      this.isSidebarOpen = true;
    }
  }

  public openAdminView(initialView: string = 'overview'): void {
    this.initialAdminView = initialView;
    this.isAdminViewOpen = true;
    this.location.replaceState(`/admin/${initialView}`);
  }

  public closeAdminView(): void {
    this.isAdminViewOpen = false;
    this.location.replaceState('/chat');
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

  private static readonly MOBILE_BREAKPOINT_PX = 1024;
  public isSidebarOpen = window.innerWidth >= AppComponent.MOBILE_BREAKPOINT_PX;

  constructor(
    public authService: AuthService,
    private location: Location
  ) {}

  public closeSidebarOnMobile(): void {
    if (window.innerWidth < AppComponent.MOBILE_BREAKPOINT_PX) {
      this.isSidebarOpen = false;
    }
  }
}
