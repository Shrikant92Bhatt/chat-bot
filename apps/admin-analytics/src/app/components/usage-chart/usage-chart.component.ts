import { Component, ChangeDetectionStrategy, input, signal, computed, ElementRef, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DailyUsagePoint } from '../../services/admin-api.service';

export type ChartMetric = 'requests' | 'tokens' | 'cost';

interface PlottedPoint {
  date: string;
  label: string;
  value: number;
  x: number;
  y: number;
}

/**
 * Daily usage over the selected window, as inline SVG.
 *
 * No charting library: nothing in this repo installs one, and a single
 * time-series needs a path, an axis and a hover layer - all of which are
 * cheaper to write than to configure. The design follows the project's
 * dataviz guidance:
 *
 *  - FORM: trend over time, ONE series at a time (a metric toggle switches
 *    which). Area for a single series. Deliberately never two y-scales -
 *    requests, tokens and cost live on incomparable scales, so they get
 *    separate renders rather than a dual axis (the single worst chart
 *    mistake: it invents a correlation that isn't in the data).
 *  - COLOR: one series, so no legend box - the chart's title names it. Marks
 *    wear the series hue; every label wears a text token, never the data
 *    colour. The mark colour (#0891b2) is a re-stepped accentCyan chosen so
 *    the palette clears the OKLCH lightness band, chroma floor, CVD
 *    separation and >=3:1 contrast against this app's glass surface
 *    (#0d1220) - validated with the dataviz palette validator, not eyeballed.
 *  - MARKS: 2px line, 8px end/active markers with a 2px surface ring, area
 *    fill at ~12% opacity, solid hairline gridlines one step off the surface
 *    (never dashed), y ticks rounded to clean numbers.
 *  - INTERACTION: a crosshair that snaps to the nearest day so the reader
 *    aims at a date rather than at a 2px line, plus keyboard arrow-key
 *    navigation exposing the same readout as hover.
 *  - The tooltip ENHANCES, it never gates: `showTable` flips to a table view
 *    carrying every value the chart plots.
 */
@Component({
  selector: 'app-usage-chart',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './usage-chart.component.html',
})
export class UsageChartComponent {
  public readonly daily = input.required<DailyUsagePoint[]>();
  public readonly metric = input<ChartMetric>('requests');
  /** Dims the plot during a refetch instead of flashing a skeleton. */
  public readonly refreshing = input(false);

  private readonly svgRef = viewChild<ElementRef<SVGSVGElement>>('svgEl');

  public readonly activeIndex = signal<number | null>(null);
  public readonly showTable = signal(false);

  // ── Geometry. Fixed viewBox, scaled with `width:100%; height:auto`, so the
  // container grows with its content and the x-axis band is always inside the
  // box (a fixed pixel height is what causes clipped axis labels).
  public readonly VIEW_W = 720;
  public readonly VIEW_H = 260;
  private readonly PAD_L = 56;
  private readonly PAD_R = 14;
  private readonly PAD_T = 14;
  private readonly PAD_B = 30;

  public readonly plotLeft = this.PAD_L;
  public readonly plotRight = this.VIEW_W - this.PAD_R;
  public readonly plotTop = this.PAD_T;
  public readonly plotBottom = this.VIEW_H - this.PAD_B;

  public readonly metricLabel = computed(() => {
    switch (this.metric()) {
      case 'tokens':
        return 'Tokens per day';
      case 'cost':
        return 'Estimated cost per day';
      default:
        return 'Requests per day';
    }
  });

  private rawValue(point: DailyUsagePoint): number {
    switch (this.metric()) {
      case 'tokens':
        return point.totalTokens;
      case 'cost':
        return point.estimatedCostUsd;
      default:
        return point.requests;
    }
  }

  /** Upper bound of the y-axis, rounded up to a clean 1/2/5 x 10^n step. */
  public readonly yMax = computed(() => {
    const peak = Math.max(0, ...this.daily().map((p) => this.rawValue(p)));
    if (peak <= 0) return 1;

    const magnitude = Math.pow(10, Math.floor(Math.log10(peak)));
    const normalized = peak / magnitude;
    const niceStep = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return niceStep * magnitude;
  });

  public readonly points = computed<PlottedPoint[]>(() => {
    const data = this.daily();
    const max = this.yMax();
    const width = this.plotRight - this.plotLeft;
    const height = this.plotBottom - this.plotTop;
    // A single-point window would divide by zero; pin it to the left edge.
    const step = data.length > 1 ? width / (data.length - 1) : 0;

    return data.map((point, i) => {
      const value = this.rawValue(point);
      return {
        date: point.date,
        label: this.formatDateLabel(point.date),
        value,
        x: this.plotLeft + step * i,
        y: this.plotBottom - (value / max) * height,
      };
    });
  });

  public readonly linePath = computed(() => {
    const pts = this.points();
    if (!pts.length) return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  });

  /** The line path closed down to the baseline, for the area wash. */
  public readonly areaPath = computed(() => {
    const pts = this.points();
    if (!pts.length) return '';
    const first = pts[0];
    const last = pts[pts.length - 1];
    return `${this.linePath()} L${last.x.toFixed(2)},${this.plotBottom} L${first.x.toFixed(2)},${this.plotBottom} Z`;
  });

  /** Four gridlines + the baseline, at clean values. */
  public readonly yTicks = computed(() => {
    const max = this.yMax();
    const height = this.plotBottom - this.plotTop;
    const DIVISIONS = 4;

    return Array.from({ length: DIVISIONS + 1 }, (_, i) => {
      const value = (max / DIVISIONS) * i;
      return {
        value,
        label: this.formatValue(value),
        y: this.plotBottom - (height / DIVISIONS) * i,
      };
    });
  });

  /**
   * At most 6 x labels, evenly spaced, so a 90-day window doesn't render 90
   * overlapping dates. The first and last day are always among them.
   */
  public readonly xTicks = computed(() => {
    const pts = this.points();
    if (pts.length <= 1) return pts.map((p, index) => ({ ...p, index }));

    const MAX_LABELS = 6;
    const stride = Math.max(1, Math.ceil(pts.length / MAX_LABELS));
    const ticks = pts
      .map((p, index) => ({ ...p, index }))
      .filter((p) => p.index % stride === 0 || p.index === pts.length - 1);

    // Drop the second-to-last tick if the stride left it crowding the last one.
    if (ticks.length > 1) {
      const last = ticks[ticks.length - 1];
      const prev = ticks[ticks.length - 2];
      if (last.x - prev.x < (this.plotRight - this.plotLeft) / (MAX_LABELS * 1.6)) {
        ticks.splice(ticks.length - 2, 1);
      }
    }
    return ticks;
  });

  public readonly activePoint = computed(() => {
    const index = this.activeIndex();
    const pts = this.points();
    return index === null || index < 0 || index >= pts.length ? null : pts[index];
  });

  /** Tooltip x position as a % of container width, so it tracks the scaled SVG. */
  public readonly tooltipLeftPct = computed(() => {
    const point = this.activePoint();
    return point ? (point.x / this.VIEW_W) * 100 : 0;
  });

  public readonly hasData = computed(() => this.points().some((p) => p.value > 0));

  // ── Hover / focus ────────────────────────────────────────────────────────

  /**
   * Maps a pointer position to the NEAREST day rather than requiring a hit on
   * the 2px line - the reader aims at a date, not at a mark.
   */
  public onPointerMove(event: PointerEvent | MouseEvent): void {
    const svg = this.svgRef()?.nativeElement;
    const pts = this.points();
    if (!svg || pts.length === 0) return;

    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;

    const viewX = ((event.clientX - rect.left) / rect.width) * this.VIEW_W;

    let nearest = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const distance = Math.abs(pts[i].x - viewX);
      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = i;
      }
    }
    this.activeIndex.set(nearest);
  }

  public clearActive(): void {
    this.activeIndex.set(null);
  }

  /** Arrow keys give keyboard users the same readout the pointer gets. */
  public onKeydown(event: KeyboardEvent): void {
    const pts = this.points();
    if (!pts.length) return;

    const current = this.activeIndex();
    let next: number | null = current;

    switch (event.key) {
      case 'ArrowRight':
        next = current === null ? 0 : Math.min(current + 1, pts.length - 1);
        break;
      case 'ArrowLeft':
        next = current === null ? pts.length - 1 : Math.max(current - 1, 0);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = pts.length - 1;
        break;
      case 'Escape':
        next = null;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.activeIndex.set(next);
  }

  public toggleTable(): void {
    this.showTable.update((v) => !v);
  }

  // ── Formatting ───────────────────────────────────────────────────────────

  public formatValue(value: number): string {
    if (this.metric() === 'cost') {
      // Sub-cent daily figures are normal here, so don't round them to $0.00.
      if (value === 0) return '$0';
      return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
    }
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
    return String(Math.round(value));
  }

  public formatDateLabel(isoDate: string): string {
    // The API emits UTC YYYY-MM-DD; parse as UTC so the label can't slip a day.
    const [year, month, day] = isoDate.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
}
