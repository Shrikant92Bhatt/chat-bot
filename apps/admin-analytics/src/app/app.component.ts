import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminAuthService } from './services/admin-auth.service';
import { LoginComponent } from './pages/login/login.component';
import { AccessDeniedComponent } from './pages/access-denied/access-denied.component';
import { DashboardComponent } from './pages/dashboard/dashboard.component';

type Screen = 'login' | 'access-denied' | 'dashboard';

/**
 * Shell. Picks the screen from auth state:
 *
 *   not signed in                 -> login
 *   signed in, an admin call 403d -> access-denied
 *   signed in                     -> dashboard
 *
 * Why this is a signal switch and not a router guard: the app cannot know
 * whether the user is an admin until the backend tells it. Authorization
 * lives entirely server-side (requireAdmin does a fresh Firestore role read
 * per request) and there is deliberately no role claim in the JWT to inspect
 * client-side. A canActivate guard would therefore have to fire its own probe
 * request and block navigation on it, and a guard that redirects on failure
 * produces the classic loop - the session is valid, so the login screen
 * immediately sends the user back. Rendering from state instead means the
 * dashboard mounts, its first API call answers the question, and a 403 flips
 * `accessDenied` so the shell swaps the view in place. The client-side check
 * is presentation only; the real boundary is, and stays, the 403.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, LoginComponent, AccessDeniedComponent, DashboardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (screen()) {
      @case ('login') {
        <app-login />
      }
      @case ('access-denied') {
        <app-access-denied />
      }
      @default {
        <app-dashboard />
      }
    }
  `,
})
export class AppComponent {
  private readonly auth = inject(AdminAuthService);

  public readonly screen = computed<Screen>(() => {
    if (!this.auth.isAuthenticated()) return 'login';
    if (this.auth.accessDenied()) return 'access-denied';
    return 'dashboard';
  });
}
