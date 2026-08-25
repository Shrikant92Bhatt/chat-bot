import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartData } from '@chat-monorepo/shared';

/** Renders a CHART UIComponent (line/area/bar/scatter/pie), computing its own SVG geometry. */
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

  // --- CHART geometry (SVG viewBox is 0 0 300 120; unitless numbers below map 1:1 to it) ---

  private readonly chartW = 300;
  private readonly chartH = 120;
  private readonly pad = 12;

  private valueRange(data: ChartData): { min: number; max: number } {
    const all = data.series.flatMap((s) => s.data);
    const min = Math.min(0, ...all);
    const max = Math.max(1, ...all);
    return { min, max: max === min ? min + 1 : max };
  }

  private xStep(count: number): number {
    return count > 1 ? (this.chartW - 2 * this.pad) / (count - 1) : 0;
  }

  private toY(value: number, min: number, max: number): number {
    return this.pad + (this.chartH - 2 * this.pad) * (1 - (value - min) / (max - min));
  }

  public linePoints(data: ChartData, seriesIndex: number): string {
    const series = data.series[seriesIndex];
    if (!series || series.data.length === 0) return '';
    const { min, max } = this.valueRange(data);
    const step = this.xStep(series.data.length);
    return series.data.map((v, i) => `${this.pad + i * step},${this.toY(v, min, max)}`).join(' ');
  }

  public areaPoints(data: ChartData, seriesIndex: number): string {
    const series = data.series[seriesIndex];
    if (!series || series.data.length === 0) return '';
    const line = this.linePoints(data, seriesIndex);
    const step = this.xStep(series.data.length);
    const lastX = this.pad + (series.data.length - 1) * step;
    const baseline = this.chartH - this.pad;
    return `${line} ${lastX},${baseline} ${this.pad},${baseline}`;
  }

  public barRects(data: ChartData): Array<{ x: number; y: number; width: number; height: number; color: string; value: number; label: string }> {
    const { min, max } = this.valueRange(data);
    const categoryCount = data.xAxis.length;
    const seriesCount = data.series.length || 1;
    const categoryWidth = (this.chartW - 2 * this.pad) / Math.max(1, categoryCount);
    const barGap = 2;
    const barWidth = Math.max(2, categoryWidth / seriesCount - barGap);
    const baseline = this.chartH - this.pad;

    const rects: Array<{ x: number; y: number; width: number; height: number; color: string; value: number; label: string }> = [];
    data.series.forEach((series, seriesIndex) => {
      series.data.forEach((value, categoryIndex) => {
        const x = this.pad + categoryIndex * categoryWidth + seriesIndex * (barWidth + barGap);
        const y = this.toY(value, min, max);
        rects.push({
          x,
          y,
          width: barWidth,
          height: Math.max(0, baseline - y),
          color: this.seriesColor(seriesIndex),
          value,
          label: String(data.xAxis[categoryIndex] ?? ''),
        });
      });
    });
    return rects;
  }

  public scatterPoints(data: ChartData): Array<{ cx: number; cy: number; color: string; value: number; label: string }> {
    const { min, max } = this.valueRange(data);
    const points: Array<{ cx: number; cy: number; color: string; value: number; label: string }> = [];
    data.series.forEach((series, seriesIndex) => {
      const step = this.xStep(series.data.length);
      series.data.forEach((value, i) => {
        points.push({
          cx: this.pad + i * step,
          cy: this.toY(value, min, max),
          color: this.seriesColor(seriesIndex),
          value,
          label: String(data.xAxis[i] ?? ''),
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
}
