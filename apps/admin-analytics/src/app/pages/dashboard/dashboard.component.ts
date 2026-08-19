import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminAuthService } from '../../services/admin-auth.service';
import {
  AdminApiService,
  AdminApiError,
  AdminUser,
  DailyUsagePoint,
  ModelUsageAggregate,
  StorageMetrics,
  UsageSummary,
  UserUsageAggregate,
} from '../../services/admin-api.service';
import { UsageChartComponent, ChartMetric } from '../../components/usage-chart/usage-chart.component';
import { UserUsageTableComponent } from '../../components/user-usage-table/user-usage-table.component';
import { UserManagementComponent } from '../../components/user-management/user-management.component';

/** Date-range presets. One control, above everything it scopes. */
const WINDOW_PRESETS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
] as const;

/**
 * The admin console's single view.
 *
 * Layout follows the dataviz composition rules: ONE filter row at the top
 * scoping everything below it, then the KPI row (one hero figure, the rest as
 * stat tiles), then the time-series, then the per-user and per-model
 * breakdowns, then storage and user management.
 *
 * All six admin endpoints are fetched in parallel with Promise.allSettled, so
 * one failing panel (e.g. GCS unreachable) degrades that panel only instead of
 * blanking the dashboard - the same fail-soft posture the backend's context
 * assembly uses. The single exception is a 403, which is not a panel failure
 * but an authorization outcome: AdminApiService flips the app into the
 * access-denied state and the shell swaps the whole view.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, UsageChartComponent, UserUsageTableComponent, UserManagementComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.component.html',
})
export class DashboardComponent implements OnInit {
  public readonly auth = inject(AdminAuthService);
  private readonly api = inject(AdminApiService);

  public readonly windowPresets = WINDOW_PRESETS;
  public readonly windowDays = signal<number>(30);
  public readonly chartMetric = signal<ChartMetric>('requests');

  /** First load - shows the full-page loader. */
  public readonly isInitialLoading = signal(true);
  /** Subsequent loads - panels hold their previous render at reduced opacity. */
  public readonly isRefreshing = signal(false);

  public readonly summary = signal<UsageSummary | null>(null);
  public readonly daily = signal<DailyUsagePoint[]>([]);
  public readonly totalUsers = signal(0);
  public readonly usageByUser = signal<UserUsageAggregate[]>([]);
  public readonly usageByModel = signal<ModelUsageAggregate[]>([]);
  public readonly storage = signal<StorageMetrics | null>(null);
  public readonly registeredUsers = signal<AdminUser[]>([]);

  /** Per-panel failure messages, so one dead endpoint doesn't blank the page. */
  public readonly panelErrors = signal<Record<string, string>>({});

  public readonly windowLabel = computed(
    () => WINDOW_PRESETS.find((p) => p.days === this.windowDays())?.label ?? `Last ${this.windowDays()} days`
  );

  /** Largest per-model request count, for the model bars' scale. */
  public readonly peakModelRequests = computed(() =>
    Math.max(1, ...this.usageByModel().map((m) => m.totalRequests))
  );

  public readonly adminCount = computed(
    () => this.registeredUsers().filter((user) => user.role === 'admin').length
  );

  ngOnInit(): void {
    void this.loadAll();
  }

  public async setWindow(days: number): Promise<void> {
    if (days === this.windowDays()) return;
    this.windowDays.set(days);
    await this.loadAll();
  }

  public setMetric(metric: ChartMetric): void {
    this.chartMetric.set(metric);
  }

  /** Re-fetch everything the filter row scopes, so the numbers always agree. */
  public async loadAll(): Promise<void> {
    if (this.isInitialLoading()) {
      // keep the full-page loader
    } else {
      this.isRefreshing.set(true);
    }
    this.panelErrors.set({});

    const days = this.windowDays();

    const [summary, byUser, byModel, storage, users] = await Promise.allSettled([
      this.api.getUsageSummary(days),
      this.api.getUsageByUser(days),
      this.api.getUsageByModel(days),
      this.api.getStorageMetrics(),
      this.api.getUsers(),
    ]);

    if (summary.status === 'fulfilled') {
      this.summary.set(summary.value.summary);
      this.daily.set(summary.value.daily);
      this.totalUsers.set(summary.value.totalUsers);
    } else {
      this.recordPanelError('summary', summary.reason);
    }

    if (byUser.status === 'fulfilled') {
      this.usageByUser.set(byUser.value.users);
    } else {
      this.recordPanelError('byUser', byUser.reason);
    }

    if (byModel.status === 'fulfilled') {
      this.usageByModel.set(byModel.value.models);
    } else {
      this.recordPanelError('byModel', byModel.reason);
    }

    if (storage.status === 'fulfilled') {
      this.storage.set(storage.value);
    } else {
      this.recordPanelError('storage', storage.reason);
    }

    if (users.status === 'fulfilled') {
      this.registeredUsers.set(users.value.users);
    } else {
      this.recordPanelError('users', users.reason);
    }

    this.isInitialLoading.set(false);
    this.isRefreshing.set(false);
  }

  private recordPanelError(panel: string, reason: unknown): void {
    // A 403 is handled globally by AdminApiService (it flips the shell to the
    // access-denied screen); don't also paint it as a per-panel failure.
    if (reason instanceof AdminApiError && (reason.status === 403 || reason.status === 401)) return;

    const message =
      reason instanceof Error ? reason.message : 'This panel could not be loaded. Try refreshing.';
    this.panelErrors.update((current) => ({ ...current, [panel]: message }));
  }

  public panelError(panel: string): string | null {
    return this.panelErrors()[panel] ?? null;
  }

  public modelBarWidth(model: ModelUsageAggregate): number {
    return Math.max(2, (model.totalRequests / this.peakModelRequests()) * 100);
  }

  public signOut(): void {
    this.auth.signOut();
  }

  // ── Formatting helpers ───────────────────────────────────────────────────

  /** Compact figures for stat tiles: 1,284 / 12.9K / 4.2M. */
  public compact(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toLocaleString();
  }

  public formatCost(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    if (value === 0) return '$0.00';
    return value < 0.01 ? `$${value.toFixed(5)}` : `$${value.toFixed(2)}`;
  }

  public formatNumber(value: number): string {
    return value.toLocaleString();
  }
}
