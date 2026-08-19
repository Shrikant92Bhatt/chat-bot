import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminAuthService } from '../../services/admin-auth.service';

/**
 * Shown when the user is authenticated but the admin API returned 403.
 *
 * It names the signed-in account explicitly. Without that, an operator with
 * two Google accounts sees "access denied" and has no way to tell which
 * identity was rejected - which in practice looks like the app being broken.
 * The alternative (silently redirecting back to the login screen) produces a
 * loop: sign in, bounce, sign in again, because the session is perfectly
 * valid and only the ROLE is missing.
 */
@Component({
  selector: 'app-access-denied',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './access-denied.component.html',
})
export class AccessDeniedComponent {
  public readonly auth = inject(AdminAuthService);

  /** Sign out and return to the login screen, so a different account can be used. */
  public switchAccount(): void {
    this.auth.signOut();
  }
}
