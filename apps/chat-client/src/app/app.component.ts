import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from './components/navbar/navbar.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { ChatWindowComponent } from './components/chat-window/chat-window.component';
import { MessageInputComponent } from './components/message-input/message-input.component';
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
  ],
  template: `
    <div class="h-screen w-screen flex flex-col bg-obsidian text-slate-100 overflow-hidden relative font-sans">
      <!-- Top Navigation Bar -->
      <app-navbar (toggleSidebar)="isSidebarOpen = !isSidebarOpen"></app-navbar>

      <!-- Main Layout Body (Sidebar + Chat Area) -->
      <div class="flex-1 flex overflow-hidden relative z-10">
        <!-- Sidebar is ONLY visible when user is logged in -->
        <app-sidebar *ngIf="authService.userSignal()" [isOpen]="isSidebarOpen"></app-sidebar>
        
        <main class="flex-1 flex flex-col h-full overflow-hidden bg-gradient-to-b from-obsidian via-slate-950 to-obsidian">
          <app-chat-window class="flex-1 overflow-hidden"></app-chat-window>
          <app-message-input></app-message-input>
        </main>
      </div>
    </div>
  `,
})
export class AppComponent {
  public isSidebarOpen = true;

  constructor(public authService: AuthService) {}
}
