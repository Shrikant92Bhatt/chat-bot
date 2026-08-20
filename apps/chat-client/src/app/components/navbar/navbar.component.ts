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

  // AuthService.logout() has existed all along but was never wired to any
  // UI control - there was genuinely no way to sign out of this app.
  public isProfileMenuOpen = false;

  constructor(public authService: AuthService) {}

  public toggleProfileMenu(): void {
    this.isProfileMenuOpen = !this.isProfileMenuOpen;
  }

  public signOut(): void {
    this.isProfileMenuOpen = false;
    this.authService.logout();
  }
}
