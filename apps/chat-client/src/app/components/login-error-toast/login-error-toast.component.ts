import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login-error-toast',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './login-error-toast.component.html',
})
export class LoginErrorToastComponent {
  constructor(public authService: AuthService) {}

  dismiss(): void {
    this.authService.dismissLoginError();
  }

  retry(): void {
    this.authService.dismissLoginError();
    this.authService.loginWithGoogle();
  }
}
