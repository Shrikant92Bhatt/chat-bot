import { Component, ChangeDetectionStrategy, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminApiService, AdminUser, AdminApiError } from '../../services/admin-api.service';
import { ADMIN_AUTH_BRIDGE } from '../../auth-bridge.token';

/**
 * Registered users + role management.
 *
 * The interesting case is the backend's last-admin guard: demoting the only
 * remaining admin comes back 400 `LastAdmin` with an explanatory message.
 * That message is surfaced verbatim on the affected row rather than being
 * flattened into a generic "something went wrong" - it tells the operator
 * exactly what to do (promote someone else first), and it is a rejection the
 * UI should never pretend it can retry past.
 */
@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-management.component.html',
})
export class UserManagementComponent {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(ADMIN_AUTH_BRIDGE);

  public readonly users = input.required<AdminUser[]>();
  /** Emitted after a successful role change so the parent can refetch. */
  public readonly roleChanged = output<void>();

  public readonly pendingUid = signal<string | null>(null);
  /** uid -> error message, so a failure sits on the row that caused it. */
  public readonly rowErrors = signal<Record<string, string>>({});

  public isSelf(user: AdminUser): boolean {
    return this.auth.currentUid() === user.uid;
  }

  public async changeRole(user: AdminUser, role: 'user' | 'admin'): Promise<void> {
    this.pendingUid.set(user.uid);
    this.clearError(user.uid);

    try {
      await this.api.setUserRole(user.uid, role);
      this.roleChanged.emit();

      // Demoting yourself is legal once another admin exists - the very next
      // admin call will 403 (requireAdmin re-reads the role from Firestore on
      // every request), so flip straight to the access-denied state rather
      // than letting the dashboard silently break around them.
      if (this.isSelf(user) && role === 'user') {
        this.api.accessDenied.set(true);
      }
    } catch (e) {
      const message =
        e instanceof AdminApiError ? e.message : 'Could not update this user’s role. Please try again.';
      this.rowErrors.update((current) => ({ ...current, [user.uid]: message }));
    } finally {
      this.pendingUid.set(null);
    }
  }

  public clearError(uid: string): void {
    this.rowErrors.update((current) => {
      const next = { ...current };
      delete next[uid];
      return next;
    });
  }

  public errorFor(uid: string): string | null {
    return this.rowErrors()[uid] ?? null;
  }

  public formatTimestamp(value: number | null): string {
    return value ? new Date(value).toLocaleString() : 'never';
  }
}
