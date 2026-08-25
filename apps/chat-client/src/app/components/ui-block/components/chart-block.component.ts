import { Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartData, ChartKind } from '@chat-monorepo/shared';

export interface ChartValueRange {
  min: number;
  max: number;
}

export interface ChartTooltipLine {
  label: string;
  value: string;
  color: string;
}

export interface ChartTooltipState {
  /** Identity of the hovered/tapped mark, so a second tap on the same mark toggles it off. */
  key: string;
  /** Horizontal position as a percentage of the chart width, pre-clamped so the tooltip never hangs off an edge. */
  xPct: number;
  heading: string;
  lines: ChartTooltipLine[];
}

export interface ChartAxisTick {
  x: number;
  label: string;
}

export interface ChartYTick {
  y: number;
  label: string;
}

export interface ChartHoverBand {
  x: number;
  width: number;
  key: string;
  heading: string;
  lines: ChartTooltipLine[];
}

/**
 * Renders a CHART UIComponent (line/area/bar/scatter/pie), computing its own
 * SVG geometry. No charting library - this repo hand-writes inline SVG for
 * every chart (see `libs/frontend/admin-analytics`'s usage chart), so this
 * component follows the same pattern rather than diverging from it.
 *
 * - Y-domain is picked per chart type, not shared indiscriminately: bar/area
 *   are zero-based (a bar axis that doesn't start at zero visually exaggerates
 *   differences), line/scatter autoscale to the local min/max (showing local
 *   variation is the point there, and forcing zero would flatten it).
 * - Tooltips are a real positioned element (not just a `<title>`), wired to
 *   both hover and click/focus so touch users on this mobile-used chat app
 *   get the same exact-value readout as a mouse user.
 * - Axis labels are minimal by design: x-axis categories (thinned to at most
 *   6 so they never overlap) and 3 y-axis ticks (min/mid/max) - enough to
 *   read the chart without a full tick-generation algorithm.
 */
@Component({
  selector: 'app-ui-chart-block',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chart-block.component.html',
  host: { style: 'display: contents' },
})
export class ChartBlockComponent {
  @Input({ required: true }) data!: ChartData;

  private readonly seriesPalette = ['#06b6d4', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#38bdf8'];

  public seriesColor(index: number): string {
    return this.seriesPalette[index % this.seriesPalette.length];
  }

  // --- CHART geometry (SVG viewBox is 0 0 300 132; unitless numbers below map 1:1 to it) ---

  public readonly chartW = 300;
  public readonly chartH = 132;
  public readonly padLeft = 30;
  public readonly padRight = 8;
  public readonly padTop = 10;
  public readonly padBottom = 20;
  public readonly plotW = this.chartW - this.padLeft - this.padRight;
  public readonly plotH = this.chartH - this.padTop - this.padBottom;
  public readonly viewBox = `0 0 ${this.chartW} ${this.chartH}`;

  /** Active tooltip, if a mark is currently hovered/focused/tapped. */
  public readonly tooltip = signal<ChartTooltipState | null>(null);

  // --- Empty state -----------------------------------------------------------

  /** `series` with all-empty `data` arrays (or zero series) has nothing to plot. */
  public hasData(data: ChartData): boolean {
    return data.series.length > 0 && data.series.some((s) => s.data.length > 0);
  }

  // --- Accessible description -------------------------------------------------

  public chartSummary(data: ChartData): string {
    const titlePart = data.title ? `${data.title}. ` : '';
    const typeLabel = this.chartTypeLabel(data.chartType);
    if (!this.hasData(data)) {
      return `${titlePart}${typeLabel} with no data to display.`;
    }
    const values = data.series.flatMap((s) => s.data).filter((v) => Number.isFinite(v));
    const seriesCount = data.series.length;
    if (values.length === 0) {
      return `${titlePart}${typeLabel} with ${seriesCount} series and no numeric values.`;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    return `${titlePart}${typeLabel} with ${seriesCount} series across ${data.xAxis.length} categories, values ranging from ${this.formatTick(min)} to ${this.formatTick(max)}.`;
  }

  private chartTypeLabel(type: ChartKind): string {
    switch (type) {
      case 'line':
        return 'Line chart';
      case 'area':
        return 'Area chart';
      case 'bar':
        return 'Bar chart';
      case 'scatter':
        return 'Scatter chart';
      case 'pie':
        return 'Pie chart';
      default:
        return 'Chart';
    }
  }

  // --- Value domain (per chart type - see class doc) --------------------------

  /**
   * Zero is always inside the domain, so a filled/baseline chart type (bar,
   * area) never gets a truncated axis that exaggerates its differences.
   */
  private zeroBasedRange(all: number[]): ChartValueRange {
    const min = Math.min(0, ...all);
    const max = Math.max(0, ...all);
    return min === max ? { min, max: min + 1 } : { min, max };
  }

  /**
   * Scales to the data's own min/max (plus a little headroom) so local
   * variation is visible instead of being flattened against a forced zero.
   */
  private autoRange(all: number[]): ChartValueRange {
    const min = Math.min(...all);
    const max = Math.max(...all);
    if (min === max) {
      const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
      return { min: min - pad, max: max + pad };
    }
    const pad = (max - min) * 0.08;
    return { min: min - pad, max: max + pad };
  }

  public valueRange(data: ChartData): ChartValueRange {
    const all = data.series.flatMap((s) => s.data).filter((v) => Number.isFinite(v));
    if (all.length === 0) return { min: 0, max: 1 };
    switch (data.chartType) {
      case 'bar':
      case 'area':
        return this.zeroBasedRange(all);
      default:
        return this.autoRange(all);
    }
  }

  private xStep(count: number): number {
    return count > 1 ? this.plotW / (count - 1) : 0;
  }

  private toY(value: number, range: ChartValueRange): number {
    return this.padTop + this.plotH * (1 - (value - range.min) / (range.max - range.min));
  }

  private pointXPositions(count: number): number[] {
    const step = this.xStep(count);
    return Array.from({ length: count }, (_, i) => this.padLeft + i * step);
  }

  private categoryWidth(categoryCount: number): number {
    return this.plotW / Math.max(1, categoryCount);
  }

  // --- Marks --------------------------------------------------------------

  public linePoints(data: ChartData, seriesIndex: number): string {
    const series = data.series[seriesIndex];
    if (!series || series.data.length === 0) return '';
    const range = this.valueRange(data);
    const positions = this.pointXPositions(series.data.length);
    return series.data.map((v, i) => `${positions[i]},${this.toY(v, range)}`).join(' ');
  }

  public areaPoints(data: ChartData, seriesIndex: number): string {
    const series = data.series[seriesIndex];
    if (!series || series.data.length === 0) return '';
    const line = this.linePoints(data, seriesIndex);
    const range = this.valueRange(data);
    const positions = this.pointXPositions(series.data.length);
    const lastX = positions[positions.length - 1];
    const firstX = positions[0];
    const baseline = this.toY(0, range);
    return `${line} ${lastX},${baseline} ${firstX},${baseline}`;
  }

  public barRects(
    data: ChartData,
  ): Array<{ x: number; y: number; width: number; height: number; color: string; value: number; label: string; seriesName: string; key: string }> {
    const range = this.valueRange(data);
    const categoryCount = data.xAxis.length;
    const seriesCount = data.series.length || 1;
    const categoryWidth = this.categoryWidth(categoryCount);
    const barGap = 2;
    const barWidth = Math.max(2, categoryWidth / seriesCount - barGap);
    const zeroY = this.toY(0, range);

    const rects: Array<{ x: number; y: number; width: number; height: number; color: string; value: number; label: string; seriesName: string; key: string }> = [];
    data.series.forEach((series, seriesIndex) => {
      series.data.forEach((value, categoryIndex) => {
        const x = this.padLeft + categoryIndex * categoryWidth + seriesIndex * (barWidth + barGap);
        const valueY = this.toY(value, range);
        const y = Math.min(valueY, zeroY);
        rects.push({
          x,
          y,
          width: barWidth,
          height: Math.max(0, Math.abs(zeroY - valueY)),
          color: this.seriesColor(seriesIndex),
          value,
          label: String(data.xAxis[categoryIndex] ?? ''),
          seriesName: series.name,
          key: `bar-${seriesIndex}-${categoryIndex}`,
        });
      });
    });
    return rects;
  }

  public scatterPoints(
    data: ChartData,
  ): Array<{ cx: number; cy: number; color: string; value: number; label: string; seriesName: string; key: string }> {
    const range = this.valueRange(data);
    const points: Array<{ cx: number; cy: number; color: string; value: number; label: string; seriesName: string; key: string }> = [];
    data.series.forEach((series, seriesIndex) => {
      const positions = this.pointXPositions(series.data.length);
      series.data.forEach((value, i) => {
        points.push({
          cx: positions[i],
          cy: this.toY(value, range),
          color: this.seriesColor(seriesIndex),
          value,
          label: String(data.xAxis[i] ?? ''),
          seriesName: series.name,
          key: `pt-${seriesIndex}-${i}`,
        });
      });
    });
    return points;
  }

  public pieSlices(data: ChartData): Array<{ dasharray: string; dashoffset: number; color: string; label: string; value: number; percent: number }> {
    const values = data.series[0]?.data ?? [];
    const total = values.reduce((sum, v) => sum + Math.max(0, v), 0) || 1;
    const circumference = 2 * Math.PI * 40;
    let cumulative = 0;
    return values.map((value, i) => {
      const safeValue = Math.max(0, value);
      const percent = safeValue / total;
      const dasharray = `${circumference * percent} ${circumference * (1 - percent)}`;
      const dashoffset = -cumulative * circumference;
      cumulative += percent;
      return {
        dasharray,
        dashoffset,
        color: this.seriesColor(i),
        label: String(data.xAxis[i] ?? ''),
        value: safeValue,
        percent: Math.round(percent * 100),
      };
    });
  }

  // --- Axes -----------------------------------------------------------------

  /** Category x positions for line/area/scatter (points) or bar (grouped centers). */
  private categoryCenters(data: ChartData): number[] {
    const count = data.xAxis.length;
    if (data.chartType === 'bar') {
      const width = this.categoryWidth(count);
      return Array.from({ length: count }, (_, i) => this.padLeft + i * width + width / 2);
    }
    return this.pointXPositions(count);
  }

  /** At most 6 x-axis labels, evenly spaced, so a long category list never overlaps. */
  public xAxisTicks(data: ChartData): ChartAxisTick[] {
    const count = data.xAxis.length;
    if (count === 0) return [];
    const positions = this.categoryCenters(data);
    const MAX_LABELS = 6;
    const stride = Math.max(1, Math.ceil(count / MAX_LABELS));
    const ticks: ChartAxisTick[] = [];
    for (let i = 0; i < count; i++) {
      if (i % stride === 0 || i === count - 1) {
        ticks.push({ x: positions[i], label: String(data.xAxis[i] ?? '') });
      }
    }
    return ticks;
  }

  /** Min/mid/max gridlines - enough to read the scale without over-engineering full tick generation. */
  public yAxisTicks(data: ChartData): ChartYTick[] {
    const range = this.valueRange(data);
    const mid = (range.min + range.max) / 2;
    return [
      { y: this.toY(range.max, range), label: this.formatTick(range.max) },
      { y: this.toY(mid, range), label: this.formatTick(mid) },
      { y: this.toY(range.min, range), label: this.formatTick(range.min) },
    ];
  }

  public formatTick(value: number): string {
    if (!Number.isFinite(value)) return '0';
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(abs < 10 ? 2 : 1);
  }

  // --- Hover bands (line/area: one full-height band per category) -----------

  public hoverBands(data: ChartData): ChartHoverBand[] {
    const count = data.xAxis.length;
    if (count === 0) return [];
    const positions = this.pointXPositions(count);
    const step = count > 1 ? positions[1] - positions[0] : this.plotW;
    return positions.map((x, index) => ({
      x: Math.max(this.padLeft, x - step / 2),
      width: Math.min(step, this.plotW),
      key: `cat-${index}`,
      heading: String(data.xAxis[index] ?? ''),
      lines: data.series.map((s, i) => ({
        label: s.name,
        value: this.formatTick(s.data[index] ?? 0),
        color: this.seriesColor(i),
      })),
    }));
  }

  // --- Tooltip interaction ----------------------------------------------------

  private tooltipXPct(x: number): number {
    return Math.min(92, Math.max(8, (x / this.chartW) * 100));
  }

  public showTooltip(key: string, x: number, heading: string, lines: ChartTooltipLine[]): void {
    this.tooltip.set({ key, xPct: this.tooltipXPct(x), heading, lines });
  }

  public hideTooltip(): void {
    this.tooltip.set(null);
  }

  /** Tap/click toggles: tapping the same mark again dismisses it (touch has no hover-away). */
  public toggleTooltip(key: string, x: number, heading: string, lines: ChartTooltipLine[]): void {
    if (this.tooltip()?.key === key) {
      this.hideTooltip();
    } else {
      this.showTooltip(key, x, heading, lines);
    }
  }
}
