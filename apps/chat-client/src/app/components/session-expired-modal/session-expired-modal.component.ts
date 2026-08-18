import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-session-expired-modal',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './session-expired-modal.component.html',
})
export class SessionExpiredModalComponent {
  constructor(public authService: AuthService) {}

  signInAgain(): void {
    this.authService.loginWithGoogle();
  }

  dismiss(): void {
    this.authService.dismissSessionExpired();
  }
}
