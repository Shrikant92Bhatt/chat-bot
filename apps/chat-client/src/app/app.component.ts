import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from './components/navbar/navbar.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { ChatWindowComponent } from './components/chat-window/chat-window.component';
import { MessageInputComponent } from './components/message-input/message-input.component';

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
    <div class="h-screen w-screen flex flex-col bg-abyss text-slate-100 overflow-hidden relative font-sans">
      <!-- Top Navigation Bar -->
      <app-navbar (toggleSidebar)="isSidebarOpen = !isSidebarOpen"></app-navbar>

      <!-- Main Layout Body (Sidebar + Chat Area) -->
      <div class="flex-1 flex overflow-hidden relative z-10">
        <app-sidebar [isOpen]="isSidebarOpen"></app-sidebar>
        
        <main class="flex-1 flex flex-col h-full overflow-hidden bg-gradient-to-b from-abyss via-[#070c18] to-abyss">
          <app-chat-window class="flex-1 overflow-hidden"></app-chat-window>
          <app-message-input></app-message-input>
        </main>
      </div>
    </div>
  `,
})
export class AppComponent {
  public isSidebarOpen = true;
}
