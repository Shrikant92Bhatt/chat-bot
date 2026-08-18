import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './navbar.component.html',
})
export class NavbarComponent {
  @Output() toggleSidebar = new EventEmitter<void>();
  @Output() openSettings = new EventEmitter<void>();

  constructor(public authService: AuthService) {}
}
