import { Component, EventEmitter, Output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';

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

  constructor(public authService: AuthService) {}
}
