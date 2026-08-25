import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StockChartData } from '@chat-monorepo/shared';

/** Renders a STOCK_CHART UIComponent - a sparkline of recent price points. */
@Component({
  selector: 'app-ui-stock-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stock-chart.component.html',
  host: { style: 'display: contents' },
})
export class StockChartComponent {
  @Input({ required: true }) data!: StockChartData;

  // --- Sparkline geometry (SVG viewBox is 0 0 300 120; unitless numbers below map 1:1 to it) ---

  private readonly chartW = 300;
  private readonly chartH = 120;
  private readonly pad = 12;

  private xStep(count: number): number {
    return count > 1 ? (this.chartW - 2 * this.pad) / (count - 1) : 0;
  }

  private toY(value: number, min: number, max: number): number {
    return this.pad + (this.chartH - 2 * this.pad) * (1 - (value - min) / (max - min));
  }

  public stockSparklinePoints(data: StockChartData): string {
    if (!data.points || data.points.length === 0) return '';
    const prices = data.points.map((p) => p.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max === min ? 1 : max - min;
    const step = this.xStep(data.points.length);
    return data.points
      .map((p, i) => `${this.pad + i * step},${this.toY(p.price, min, min + range)}`)
      .join(' ');
  }
}
