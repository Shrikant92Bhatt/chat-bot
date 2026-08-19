import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminAuthService } from '../../services/admin-auth.service';

/**
 * Sign-in screen. Uses the same Google client ID as chat-client (fetched from
 * the public GET /api/chat/config) and the same POST /api/auth/session
 * exchange - only the localStorage key differs.
 *
 * Signing in successfully does NOT imply access: authorization is decided
 * per-request by the backend's requireAdmin. A non-admin who signs in here
 * lands on the access-denied screen, which is stated up front so the outcome
 * isn't a surprise.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.component.html',
})
export class LoginComponent {
  public readonly auth = inject(AdminAuthService);
}
