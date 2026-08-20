import { Component, ChangeDetectionStrategy, input, output, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  DailyUsagePoint,
  ModelUsageAggregate,
  StorageMetrics,
  UsageSummary,
} from '../../services/admin-api.service';
import { UsageChartComponent, ChartMetric } from '../../components/usage-chart/usage-chart.component';
import { SparklineComponent } from '../../components/sparkline/sparkline.component';

/**
 * The Overview view: the system-wide pulse, in one screen.
 *
 * Composition follows the dataviz rules the console already uses:
 *  - exactly ONE hero figure per view (estimated cost - what an operator opens
 *    this console to see); everything else is a stat tile, so the page has a
 *    single obvious entry point rather than six equally loud numbers;
 *  - each tile carries a sparkline for shape and a figure for value. The
 *    sparkline never has to be read for a number - the same series, day by
 *    day, is in the chart directly below and in its table twin;
 *  - one series at a time in the time-series, never a dual axis: requests,
 *    tokens and cost live on incomparable scales, so a toggle switches which
 *    is plotted instead of stacking two y-scales on one plot.
 *
 * Colour is deliberately restrained: one accent hue carries the data, amber is
 * reserved for "this number is not what it looks like" (the record cap, an
 * unconfigured bucket) and everything else is a text token. Violet appears only
 * on the Users view, where it means "admin".
 */
@Component({
  selector: 'lib-overview-view',
  standalone: true,
  imports: [CommonModule, UsageChartComponent, SparklineComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './overview-view.component.html',
})
export class OverviewViewComponent {
  public readonly summary = input.required<UsageSummary | null>();
  public readonly daily = input.required<DailyUsagePoint[]>();
  public readonly usageByModel = input.required<ModelUsageAggregate[]>();
  public readonly storage = input.required<StorageMetrics | null>();
  public readonly totalUsers = input.required<number>();
  public readonly adminCount = input.required<number>();
  public readonly windowLabel = input.required<string>();
  public readonly refreshing = input(false);

  public readonly summaryError = input<string | null>(null);
  public readonly modelError = input<string | null>(null);
  public readonly storageError = input<string | null>(null);

  /** "Registered users" tile links across to the view that owns them. */
  public readonly viewUsers = output<void>();

  /** The one mark colour on this page. */
  public readonly SERIES = '#0891b2';
  /** De-emphasis hue for the supporting tiles' sparklines. */
  public readonly MUTED = '#64748b';

  public readonly chartMetric = signal<ChartMetric>('requests');

  public setMetric(metric: ChartMetric): void {
    this.chartMetric.set(metric);
  }

  public readonly chartMetricLabel = computed(() => {
    switch (this.chartMetric()) {
      case 'tokens':
        return 'Tokens per day';
      case 'cost':
        return 'Estimated cost per day';
      default:
        return 'Requests per day';
    }
  });

  // ── Sparkline series ─────────────────────────────────────────────────────
  public readonly costSeries = computed(() => this.daily().map((d) => d.estimatedCostUsd));
  public readonly requestSeries = computed(() => this.daily().map((d) => d.requests));
  public readonly tokenSeries = computed(() => this.daily().map((d) => d.totalTokens));

  /** Largest per-model request count, for the model bars' scale. */
  public readonly peakModelRequests = computed(() =>
    Math.max(1, ...this.usageByModel().map((m) => m.totalRequests))
  );

  public readonly totalModelRequests = computed(() =>
    this.usageByModel().reduce((sum, m) => sum + m.totalRequests, 0)
  );

  public modelBarWidth(model: ModelUsageAggregate): number {
    return Math.max(1.5, (model.totalRequests / this.peakModelRequests()) * 100);
  }

  public modelShare(model: ModelUsageAggregate): string {
    const total = this.totalModelRequests();
    if (total === 0) return '—';
    return `${((model.totalRequests / total) * 100).toFixed(0)}%`;
  }

  /**
   * The `usage` collection keys on the uid that made the request, and the
   * registry only holds accounts that still exist - so a deleted account's
   * traffic keeps counting toward `activeUsers` with nothing left to divide
   * by. When that happens "N of M registered" is not a proportion, and the
   * tile says so instead of drawing a bar that overflows its own track.
   */
  public readonly activeExceedsRegistry = computed(() => {
    const stats = this.summary();
    return !!stats && stats.activeUsers > this.totalUsers();
  });

  public readonly activeShare = computed(() => {
    const stats = this.summary();
    const total = this.totalUsers();
    if (!stats || total <= 0) return 0;
    return Math.min(100, (stats.activeUsers / total) * 100);
  });

  /**
   * Percentage of the window's days that carried at least one request - the
   * honest "is this dashboard looking at a real workload or three test days"
   * signal, and cheap to compute from the series already loaded.
   */
  public readonly activeDays = computed(() => this.daily().filter((d) => d.requests > 0).length);

  // ── Formatting ───────────────────────────────────────────────────────────

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

  /**
   * The storage endpoint returns an ISO string. Printing it raw put a
   * `2026-08-20T05:31:19.738Z` in the corner of a card, which nobody reads as a
   * time; this renders it in the operator's own locale and timezone, and falls
   * back to the raw value rather than inventing one if it won't parse.
   */
  public formatMeasuredAt(iso: string): string {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    return parsed.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
