import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StockCardData } from '@chat-monorepo/shared';
import { StockChartComponent } from './stock-chart.component';

/** Renders a STOCK_CARD UIComponent. */
@Component({
  selector: 'app-ui-stock-card',
  standalone: true,
  imports: [CommonModule, StockChartComponent],
  templateUrl: './stock-card.component.html',
  host: { style: 'display: contents' },
})
export class StockCardComponent {
  @Input({ required: true }) data!: StockCardData;

  public changeColorClass(change: number): string {
    if (change > 0) return 'text-accentEmerald';
    if (change < 0) return 'text-accentRose';
    return 'text-slate-400';
  }

  /** Arrow + tint reflecting a stock's move, reusing the same green/red tokens changeColorClass uses. */
  public stockTrend(change: number): { arrow: string; bg: string; border: string } {
    if (change > 0) return { arrow: '▲', bg: 'bg-accentEmerald/[0.06]', border: 'border-accentEmerald/20' };
    if (change < 0) return { arrow: '▼', bg: 'bg-accentRose/[0.06]', border: 'border-accentRose/20' };
    return { arrow: '▬', bg: 'bg-white/[0.03]', border: 'border-white/10' };
  }

  public getChartData() {
    if (!this.data.chartPoints) return null;
    return {
      symbol: this.data.symbol,
      name: this.data.name,
      currency: this.data.currency,
      points: this.data.chartPoints.map((p) => ({
        timestamp: p.timestamp.toString(),
        price: p.price,
      })),
    };
  }
}
