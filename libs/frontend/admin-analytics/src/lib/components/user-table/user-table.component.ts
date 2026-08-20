import { Component, ChangeDetectionStrategy, inject, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminApiService, AdminApiError, UsageRecord } from '../../services/admin-api.service';
import { ADMIN_AUTH_BRIDGE } from '../../auth-bridge.token';
import { UserRow, userDisplayName, userInitial } from './user-row.model';

export type UserSortKey =
  | 'name'
  | 'role'
  | 'totalRequests'
  | 'totalTokens'
  | 'totalEstimatedCostUsd'
  | 'lastActivity';

/**
 * The Users view's one table: who each account is, what they consumed in the
 * window, and the role control - in a single row.
 *
 * These used to be two panels stacked on one long page (a per-user usage table,
 * then a separate registered-users list with the promote/demote buttons), which
 * meant an operator answering "who is burning tokens, and should they still be
 * an admin?" had to match names across two lists by eye. Same data, one row.
 *
 * A table rather than a chart, on purpose: this is many rows of several
 * measures each, past the point where colour classes stay legible. The one
 * graphical element is a single-hue magnitude meter under the token column - a
 * proportion of the window's total, not a value-ramp across nominal categories.
 *
 * Row expansion loads that user's individual request records (the session-level
 * drill-down), lazily and once per user.
 *
 * The role control keeps the behaviour it had as its own component, including
 * the two cases that matter:
 *  - the backend's last-admin guard (400 `LastAdmin`) is surfaced VERBATIM on
 *    the row that caused it - it tells the operator exactly what to do
 *    (promote someone else first) and is not a failure the UI may retry past;
 *  - demoting yourself is legal once another admin exists, and the very next
 *    admin call will 403 (requireAdmin re-reads the role from Firestore every
 *    request), so we flip straight to the access-denied state rather than
 *    letting the console silently break around the operator.
 */
@Component({
  selector: 'app-user-table',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-table.component.html',
})
export class UserTableComponent {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(ADMIN_AUTH_BRIDGE);

  public readonly rows = input.required<UserRow[]>();
  public readonly windowDays = input.required<number>();
  /** Emitted after a successful role change so the parent can refetch. */
  public readonly roleChanged = output<void>();

  public readonly sortKey = signal<UserSortKey>('totalTokens');
  public readonly sortDescending = signal(true);

  public readonly expandedUid = signal<string | null>(null);
  public readonly records = signal<Record<string, UsageRecord[]>>({});
  public readonly loadingRecordsFor = signal<string | null>(null);
  public readonly recordsError = signal<string | null>(null);

  public readonly pendingUid = signal<string | null>(null);
  /** uid -> message, so a failure sits on the row that caused it. */
  public readonly rowErrors = signal<Record<string, string>>({});

  public readonly displayName = userDisplayName;
  public readonly initial = userInitial;

  public readonly sortedRows = computed(() => {
    const key = this.sortKey();
    const direction = this.sortDescending() ? -1 : 1;

    return [...this.rows()].sort((a, b) => {
      if (key === 'name') {
        return userDisplayName(a).toLowerCase().localeCompare(userDisplayName(b).toLowerCase()) * direction;
      }
      if (key === 'role') {
        // Admins first when descending; unregistered rows sort last either way.
        const rank = (row: UserRow) => (row.role === 'admin' ? 2 : row.role === 'user' ? 1 : 0);
        return (rank(a) - rank(b)) * direction;
      }
      const left = key === 'lastActivity' ? (a.lastActivity ?? 0) : (a[key] as number);
      const right = key === 'lastActivity' ? (b.lastActivity ?? 0) : (b[key] as number);
      return (left - right) * direction;
    });
  });

  /** Meter is a share of the heaviest consumer, so the top row reads full. */
  private readonly peakTokens = computed(() => Math.max(1, ...this.rows().map((r) => r.totalTokens)));

  public meterWidth(row: UserRow): number {
    if (row.totalTokens === 0) return 0;
    return Math.max(2, (row.totalTokens / this.peakTokens()) * 100);
  }

  public sortBy(key: UserSortKey): void {
    if (this.sortKey() === key) {
      this.sortDescending.update((v) => !v);
      return;
    }
    this.sortKey.set(key);
    // Text sorts read better ascending; measures read better descending.
    this.sortDescending.set(key !== 'name');
  }

  public isSorted(key: UserSortKey): boolean {
    return this.sortKey() === key;
  }

  public sortAria(key: UserSortKey): 'ascending' | 'descending' | 'none' {
    if (!this.isSorted(key)) return 'none';
    return this.sortDescending() ? 'descending' : 'ascending';
  }

  // ── Drill-down ───────────────────────────────────────────────────────────

  public async toggleRow(row: UserRow): Promise<void> {
    if (this.expandedUid() === row.uid) {
      this.expandedUid.set(null);
      return;
    }

    this.expandedUid.set(row.uid);
    this.recordsError.set(null);

    // Cached after the first open - re-opening a row costs nothing.
    if (this.records()[row.uid]) return;

    this.loadingRecordsFor.set(row.uid);
    try {
      const response = await this.api.getUsageRecords(this.windowDays(), row.uid, 25);
      this.records.update((current) => ({ ...current, [row.uid]: response.records }));
    } catch (e) {
      this.recordsError.set((e as Error).message || 'Failed to load session records.');
    } finally {
      this.loadingRecordsFor.set(null);
    }
  }

  public recordsFor(uid: string): UsageRecord[] {
    return this.records()[uid] ?? [];
  }

  // ── Role management ──────────────────────────────────────────────────────

  public isSelf(row: UserRow): boolean {
    return this.auth.currentUid() === row.uid;
  }

  public async changeRole(event: Event, row: UserRow, role: 'user' | 'admin'): Promise<void> {
    // The row itself is a disclosure toggle; the role button must not also
    // expand/collapse it.
    event.stopPropagation();

    this.pendingUid.set(row.uid);
    this.clearError(row.uid);

    try {
      await this.api.setUserRole(row.uid, role);
      this.roleChanged.emit();
      if (this.isSelf(row) && role === 'user') {
        this.api.accessDenied.set(true);
      }
    } catch (e) {
      const message =
        e instanceof AdminApiError ? e.message : 'Could not update this user’s role. Please try again.';
      this.rowErrors.update((current) => ({ ...current, [row.uid]: message }));
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

  public stop(event: Event): void {
    event.stopPropagation();
  }

  // ── Formatting ───────────────────────────────────────────────────────────

  public formatNumber(value: number): string {
    return value.toLocaleString();
  }

  public compact(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toLocaleString();
  }

  public formatCost(value: number | null): string {
    if (value === null) return '—';
    if (value === 0) return '$0.00';
    return value < 0.01 ? `$${value.toFixed(5)}` : `$${value.toFixed(2)}`;
  }

  public formatSharePct(share: number): string {
    if (share <= 0) return '—';
    return share < 0.001 ? '<0.1%' : `${(share * 100).toFixed(1)}%`;
  }

  public formatTimestamp(value: number | null): string {
    if (!value) return '—';
    return new Date(value).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /** "3d ago" style, for the scanning column. Absolute value is in the title. */
  public formatRelative(value: number | null): string {
    if (!value) return 'No activity';
    const diff = Date.now() - value;
    const minutes = Math.round(diff / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
  }

  public formatAbsolute(value: number | null): string {
    return value ? new Date(value).toLocaleString() : 'never';
  }
}
