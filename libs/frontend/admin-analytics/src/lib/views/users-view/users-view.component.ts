import { Component, ChangeDetectionStrategy, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminUser, UserUsageAggregate } from '../../services/admin-api.service';
import { UserTableComponent } from '../../components/user-table/user-table.component';
import { buildUserRows, userDisplayName } from '../../components/user-table/user-row.model';

type RoleFilter = 'all' | 'admin' | 'user';

/**
 * The Users view: everything about *people*, on one page.
 *
 * The console used to answer "who is consuming what" and "who is an admin" in
 * two panels a long scroll apart. This view is the join: one row per account,
 * carrying consumption, role and the role control together, with the
 * session-level drill-down underneath.
 *
 * Membership is the *registry*, not the usage log, so a user who has spent
 * nothing this window still appears - they exist, and their access still needs
 * managing. See `buildUserRows` for the other direction (usage from a uid with
 * no account behind it).
 *
 * Search and the role filter are local, on the already-fetched rows: the
 * backend has no search parameter and the population is small enough that a
 * round-trip per keystroke would be slower and worse.
 */
@Component({
  selector: 'app-users-view',
  standalone: true,
  imports: [CommonModule, UserTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './users-view.component.html',
})
export class UsersViewComponent {
  public readonly registeredUsers = input.required<AdminUser[]>();
  public readonly usageByUser = input.required<UserUsageAggregate[]>();
  public readonly windowDays = input.required<number>();
  public readonly windowLabel = input.required<string>();
  public readonly refreshing = input(false);
  public readonly usersError = input<string | null>(null);
  public readonly usageError = input<string | null>(null);

  public readonly roleChanged = output<void>();

  public readonly search = signal('');
  public readonly roleFilter = signal<RoleFilter>('all');

  public readonly allRows = computed(() => buildUserRows(this.registeredUsers(), this.usageByUser()));

  public readonly rows = computed(() => {
    const query = this.search().trim().toLowerCase();
    const role = this.roleFilter();

    return this.allRows().filter((row) => {
      if (role === 'admin' && row.role !== 'admin') return false;
      if (role === 'user' && row.role !== 'user') return false;
      if (!query) return true;
      return (
        (row.name ?? '').toLowerCase().includes(query) ||
        (row.email ?? '').toLowerCase().includes(query) ||
        row.uid.toLowerCase().includes(query)
      );
    });
  });

  public readonly adminCount = computed(() => this.allRows().filter((r) => r.role === 'admin').length);
  public readonly memberCount = computed(() => this.allRows().filter((r) => r.role === 'user').length);
  public readonly registeredCount = computed(() => this.allRows().filter((r) => r.registered).length);
  public readonly activeCount = computed(() => this.allRows().filter((r) => r.totalRequests > 0).length);

  /** The single heaviest consumer in the window - the row an operator hunts for. */
  public readonly topConsumer = computed(() => {
    const withUsage = this.allRows().filter((r) => r.totalTokens > 0);
    if (!withUsage.length) return null;
    return withUsage.reduce((peak, row) => (row.totalTokens > peak.totalTokens ? row : peak));
  });

  public readonly topConsumerName = computed(() => {
    const top = this.topConsumer();
    return top ? userDisplayName(top) : '—';
  });

  public readonly topConsumerShare = computed(() => {
    const top = this.topConsumer();
    if (!top) return null;
    return `${(top.tokenShare * 100).toFixed(0)}% of tokens`;
  });

  public readonly totalCost = computed(() =>
    this.allRows().reduce((sum, row) => sum + row.totalEstimatedCostUsd, 0)
  );

  public onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  public clearSearch(): void {
    this.search.set('');
  }

  public setRoleFilter(filter: RoleFilter): void {
    this.roleFilter.set(filter);
  }

  public formatCost(value: number): string {
    if (value === 0) return '$0.00';
    return value < 0.01 ? `$${value.toFixed(5)}` : `$${value.toFixed(2)}`;
  }
}
