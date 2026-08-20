import { Component, ChangeDetectionStrategy, input, signal, computed, ElementRef, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DailyUsagePoint } from '../../services/admin-api.service';

export type ChartMetric = 'requests' | 'tokens' | 'cost';

interface PlottedPoint {
  date: string;
  label: string;
  longLabel: string;
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
 *    (#0d1320) - validated with the dataviz palette validator, not eyeballed.
 *  - MARKS: 2px line, >=8px active marker with a 2px surface ring, area fill
 *    fading to nothing, solid hairline gridlines one step off the surface
 *    (never dashed), y ticks rounded to clean numbers.
 *  - LABELS: selective, never one per point. The window's peak day is the one
 *    directly-labelled mark; the axis and the tooltip carry everything else.
 *  - INTERACTION: full-height hover bands (one per day, so the hit target is
 *    the whole column rather than a 2px line) driving a crosshair that snaps
 *    to a date, plus keyboard arrow-key navigation exposing the same readout.
 *  - The tooltip ENHANCES, it never gates: `showTable` flips to a table view
 *    carrying every value the chart plots.
 *
 * Curve: monotone cubic, not a raw polyline. Monotone interpolation is the one
 * smoothing family that cannot overshoot - it will never draw a dip between two
 * rising days or a peak that isn't in the data - so it buys the softer line
 * without the Catmull-Rom/cardinal failure mode of inventing extrema.
 */
@Component({
  selector: 'lib-usage-chart',
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

  /** The one mark colour. Everything else on this chart is a text/line token. */
  public readonly SERIES = '#0891b2';

  // ── Geometry. Fixed viewBox, scaled with `width:100%; height:auto`, so the
  // container grows with its content and the x-axis band is always inside the
  // box (a fixed pixel height is what causes clipped axis labels).
  public readonly VIEW_W = 960;
  public readonly VIEW_H = 300;
  private readonly PAD_L = 56;
  private readonly PAD_R = 18;
  private readonly PAD_T = 24;
  private readonly PAD_B = 32;

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
        longLabel: this.formatLongDateLabel(point.date),
        value,
        x: this.plotLeft + step * i,
        y: this.plotBottom - (value / max) * height,
      };
    });
  });

  /**
   * Monotone cubic (Fritsch-Carlson) through the plotted points. Tangents are
   * clamped so a segment can never leave the [y(i), y(i+1)] band, which is what
   * makes this safe for data: no invented dips, no invented peaks.
   */
  public readonly linePath = computed(() => {
    const pts = this.points();
    if (!pts.length) return '';
    if (pts.length === 1) return `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;

    const n = pts.length;
    const dx: number[] = [];
    const slope: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      dx.push(pts[i + 1].x - pts[i].x);
      slope.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x));
    }

    const tangent: number[] = new Array(n);
    tangent[0] = slope[0];
    tangent[n - 1] = slope[n - 2];
    for (let i = 1; i < n - 1; i++) {
      // A local extremum gets a flat tangent - that's the clamp that stops the
      // curve bulging past the data on either side of a spike.
      tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
    }
    for (let i = 0; i < n - 1; i++) {
      if (slope[i] === 0) {
        tangent[i] = 0;
        tangent[i + 1] = 0;
        continue;
      }
      const a = tangent[i] / slope[i];
      const b = tangent[i + 1] / slope[i];
      const h = Math.hypot(a, b);
      if (h > 3) {
        tangent[i] = ((3 * a) / h) * slope[i];
        tangent[i + 1] = ((3 * b) / h) * slope[i];
      }
    }

    let d = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
    for (let i = 0; i < n - 1; i++) {
      const c1x = pts[i].x + dx[i] / 3;
      const c1y = pts[i].y + (tangent[i] * dx[i]) / 3;
      const c2x = pts[i + 1].x - dx[i] / 3;
      const c2y = pts[i + 1].y - (tangent[i + 1] * dx[i]) / 3;
      d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
    }
    return d;
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

  /**
   * Full-height hover bands, one per day. The reader aims at a column, not at a
   * 2px line - and the band is the hit target, so it also satisfies the minimum
   * target size that a bare mark never would.
   */
  public readonly hoverBands = computed(() => {
    const pts = this.points();
    if (pts.length === 0) return [];
    const width = this.plotRight - this.plotLeft;
    const band = pts.length > 1 ? width / (pts.length - 1) : width;

    return pts.map((p, index) => ({
      index,
      date: p.date,
      x: Math.max(this.plotLeft, p.x - band / 2),
      width: Math.min(band, this.plotRight - Math.max(this.plotLeft, p.x - band / 2)),
    }));
  });

  public readonly activePoint = computed(() => {
    const index = this.activeIndex();
    const pts = this.points();
    return index === null || index < 0 || index >= pts.length ? null : pts[index];
  });

  /** The window's busiest day - the one point that earns a direct label. */
  public readonly peakPoint = computed(() => {
    const pts = this.points();
    if (pts.length < 3) return null;
    let peak = pts[0];
    for (const p of pts) if (p.value > peak.value) peak = p;
    return peak.value > 0 ? peak : null;
  });

  /** Keeps the peak label from hanging off either edge of the plot. */
  public readonly peakLabelAnchor = computed(() => {
    const peak = this.peakPoint();
    if (!peak) return 'middle';
    if (peak.x < this.plotLeft + 48) return 'start';
    if (peak.x > this.plotRight - 48) return 'end';
    return 'middle';
  });

  /**
   * Tooltip x as a % of container width, clamped so a tooltip on the first or
   * last day doesn't hang outside the card (the classic edge-overflow bug an
   * unconditional -translate-x-1/2 produces).
   */
  public readonly tooltipLeftPct = computed(() => {
    const point = this.activePoint();
    if (!point) return 0;
    return Math.min(88, Math.max(12, (point.x / this.VIEW_W) * 100));
  });

  public readonly hasData = computed(() => this.points().some((p) => p.value > 0));

  // ── Hover / focus ────────────────────────────────────────────────────────

  public setActive(index: number): void {
    this.activeIndex.set(index);
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

  public formatLongDateLabel(isoDate: string): string {
    const [year, month, day] = isoDate.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }
}
