import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from './components/navbar/navbar.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { ChatWindowComponent } from './components/chat-window/chat-window.component';
import { MessageInputComponent } from './components/message-input/message-input.component';
import { SessionExpiredModalComponent } from './components/session-expired-modal/session-expired-modal.component';
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
  ],
  templateUrl: './app.component.html',
})
export class AppComponent {
  public isSidebarOpen = true;

  constructor(public authService: AuthService) {}
}
