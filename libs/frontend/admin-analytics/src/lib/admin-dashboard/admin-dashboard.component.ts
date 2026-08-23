import { Component, ChangeDetectionStrategy, inject, signal, computed, output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AdminApiService,
  AdminApiError,
  AdminUser,
  DailyUsagePoint,
  ModelUsageAggregate,
  StorageMetrics,
  UsageSummary,
  UserUsageAggregate,
} from '../services/admin-api.service';
import { OverviewViewComponent } from '../views/overview-view/overview-view.component';
import { UsersViewComponent } from '../views/users-view/users-view.component';
import { ModelsViewComponent } from '../views/models-view/models-view.component';
import { LimitsViewComponent } from '../views/limits-view/limits-view.component';
import { AdminEmulatorComponent } from '@chat-monorepo/admin-emulator';

/** Date-range presets. One control, above everything it scopes. */
const WINDOW_PRESETS = [
  { days: 7, label: 'Last 7 days', short: '7d' },
  { days: 30, label: 'Last 30 days', short: '30d' },
  { days: 90, label: 'Last 90 days', short: '90d' },
] as const;

export type AdminView = 'overview' | 'users' | 'models' | 'limits' | 'emulator';

/**
 * The admin console's shell - embedded directly into the host app's shell
 * (chat-client) rather than owning its own route/page, since this lib doesn't
 * know or care what the host app's navigation looks like. The host app decides
 * how/when to show it and provides ADMIN_AUTH_BRIDGE + ADMIN_API_BASE_URL (see
 * auth-bridge.token.ts) so this stays independent of chat-client's concrete
 * AuthService.
 *
 * This component owns three things and nothing else: the data, the date-range
 * filter, and which of the views is showing.
 *
 *  - **Views, not routes.** Switching between Overview, Users, and Models is a signal
 *    flipping which child renders. This lib deliberately owns no Router (see
 *    architecture.md §5) - it is consumed into chat-client's build and rendered
 *    as an overlay *in place*, so a real route here would fight the host app's
 *    navigation and put admin state in the URL of a chat page.
 *  - **One filter row above everything it scopes.** The date range lives in the
 *    header, applies to both views, and refetches everything on change, so no
 *    two numbers on screen can be from different windows.
 *  - **Fetched once, shared by views.** Switching views is instant and
 *    costs no requests; only a date change or a role change refetches.
 *
 * All admin endpoints load in parallel with Promise.allSettled, so one
 * failing panel (e.g. GCS unreachable) degrades that panel only instead of
 * blanking the console - the same fail-soft posture the backend's context
 * assembly uses. The single exception is a 403, which is not a panel failure
 * but an authorization outcome: AdminApiService.accessDenied flips and the
 * template swaps to an inline "not authorized" state.
 */
@Component({
  selector: 'lib-admin-dashboard',
  standalone: true,
  imports: [CommonModule, OverviewViewComponent, UsersViewComponent, ModelsViewComponent, LimitsViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-dashboard.component.html',
})
export class AdminDashboardComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  /** Emitted when the operator wants to leave the admin console. Named
   *  `closed` rather than `close` - @angular-eslint/no-output-native flags
   *  `close` as colliding with the native DOM `close` event. */
  public readonly closed = output<void>();

  public readonly accessDenied = this.api.accessDenied;

  public readonly windowPresets = WINDOW_PRESETS;
  public readonly windowDays = signal<number>(30);
  public readonly activeView = signal<AdminView>('overview');
  // 'limits' loads its own data independently of everything else this shell
  // owns (see LimitsViewComponent.ngOnInit) - it doesn't scope to the
  // header's date-range filter and isn't part of loadAll()'s Promise.allSettled.

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

  public readonly adminCount = computed(
    () => this.registeredUsers().filter((user) => user.role === 'admin').length
  );

  ngOnInit(): void {
    void this.loadAll();
  }

  public setView(view: AdminView): void {
    this.activeView.set(view);
  }

  public async setWindow(days: number): Promise<void> {
    if (days === this.windowDays()) return;
    this.windowDays.set(days);
    await this.loadAll();
  }

  /** Re-fetch everything the filter row scopes, so the numbers always agree. */
  public async loadAll(): Promise<void> {
    if (!this.isInitialLoading()) {
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
    // A 403 is handled globally by AdminApiService.accessDenied (the
    // template swaps to the inline access-denied state); don't also paint
    // it as a per-panel failure.
    if (reason instanceof AdminApiError && (reason.status === 403 || reason.status === 401)) return;

    const message =
      reason instanceof Error ? reason.message : 'This panel could not be loaded. Try refreshing.';
    this.panelErrors.update((current) => ({ ...current, [panel]: message }));
  }

  public panelError(panel: string): string | null {
    return this.panelErrors()[panel] ?? null;
  }
}
