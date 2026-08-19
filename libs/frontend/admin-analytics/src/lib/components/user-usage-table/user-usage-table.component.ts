import { Component, ChangeDetectionStrategy, inject, input, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminApiService, UserUsageAggregate, UsageRecord } from '../../services/admin-api.service';

type SortKey = 'totalTokens' | 'totalRequests' | 'totalEstimatedCostUsd' | 'lastActivity' | 'email';

/**
 * Per-user consumption table - the "which user burns how many tokens" view.
 *
 * Sortable, and each row expands into that user's most recent individual
 * request records (the session-level drill-down): requestId, model, tokens,
 * cost, latency, conversation and timestamp. Records are fetched lazily, once
 * per user, the first time a row is opened.
 *
 * A table rather than a chart on purpose: this is many rows of several
 * measures each, which is past the point where colour classes stay legible.
 * The one graphical element is a single-hue magnitude meter behind the token
 * column - a proportion against the largest consumer, not a value-ramp across
 * nominal categories.
 */
@Component({
  selector: 'app-user-usage-table',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-usage-table.component.html',
})
export class UserUsageTableComponent {
  private readonly api = inject(AdminApiService);

  public readonly users = input.required<UserUsageAggregate[]>();
  public readonly windowDays = input.required<number>();

  public readonly sortKey = signal<SortKey>('totalTokens');
  public readonly sortDescending = signal(true);

  public readonly expandedUserId = signal<string | null>(null);
  public readonly records = signal<Record<string, UsageRecord[]>>({});
  public readonly loadingRecordsFor = signal<string | null>(null);
  public readonly recordsError = signal<string | null>(null);

  public readonly sortedUsers = computed(() => {
    const key = this.sortKey();
    const direction = this.sortDescending() ? -1 : 1;

    return [...this.users()].sort((a, b) => {
      if (key === 'email') {
        const left = (a.email || a.userId).toLowerCase();
        const right = (b.email || b.userId).toLowerCase();
        return left.localeCompare(right) * direction;
      }
      const left = key === 'lastActivity' ? (a.lastActivity ?? 0) : (a[key] as number);
      const right = key === 'lastActivity' ? (b.lastActivity ?? 0) : (b[key] as number);
      return (left - right) * direction;
    });
  });

  /** Largest token total, for the in-row magnitude meter. */
  public readonly peakTokens = computed(() =>
    Math.max(1, ...this.users().map((user) => user.totalTokens))
  );

  public meterWidth(user: UserUsageAggregate): number {
    return Math.max(1.5, (user.totalTokens / this.peakTokens()) * 100);
  }

  public sortBy(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDescending.update((v) => !v);
      return;
    }
    this.sortKey.set(key);
    // Text sorts read better ascending; measures read better descending.
    this.sortDescending.set(key !== 'email');
  }

  public sortIndicator(key: SortKey): string {
    if (this.sortKey() !== key) return '';
    return this.sortDescending() ? '↓' : '↑';
  }

  public async toggleRow(user: UserUsageAggregate): Promise<void> {
    if (this.expandedUserId() === user.userId) {
      this.expandedUserId.set(null);
      return;
    }

    this.expandedUserId.set(user.userId);
    this.recordsError.set(null);

    // Cached after the first open - re-opening a row costs nothing.
    if (this.records()[user.userId]) return;

    this.loadingRecordsFor.set(user.userId);
    try {
      const response = await this.api.getUsageRecords(this.windowDays(), user.userId, 25);
      this.records.update((current) => ({ ...current, [user.userId]: response.records }));
    } catch (e) {
      this.recordsError.set((e as Error).message || 'Failed to load session records.');
    } finally {
      this.loadingRecordsFor.set(null);
    }
  }

  public recordsFor(userId: string): UsageRecord[] {
    return this.records()[userId] ?? [];
  }

  public displayName(user: UserUsageAggregate): string {
    return user.email || user.name || user.userId;
  }

  public formatNumber(value: number): string {
    return value.toLocaleString();
  }

  public formatCost(value: number | null): string {
    if (value === null) return '—';
    return value < 0.01 && value > 0 ? `$${value.toFixed(5)}` : `$${value.toFixed(4)}`;
  }

  public formatTimestamp(value: number | null): string {
    if (!value) return '—';
    return new Date(value).toLocaleString();
  }
}
