import { Component, EventEmitter, Input, Output, SecurityContext } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import {
  ChartData,
  OrchestratorAction,
  OrchestratorSource,
  StockChartData,
  UIComponent,
  WeatherHourlyPoint,
} from '@chat-monorepo/shared';

/**
 * Renders the orchestrator's approved, pre-validated UI components.
 *
 * This is the ONLY place the model's structured `ui` payload turns into
 * markup - and it never trusts that payload as markup itself. Every field
 * is bound through Angular interpolation/property binding (auto-escaped),
 * never [innerHTML], except MARKDOWN/TEXT text which goes through the same
 * marked + DOMPurify + Angular-sanitizer pipeline chat-window.component.ts
 * uses for the main reply. The backend has already validated the payload
 * against a strict schema and rejected anything containing HTML-looking
 * content (see apps/chat-api/src/orchestration/ui-schema.ts) - this is a
 * second, independent layer, not the only one.
 */
@Component({
  selector: 'app-ui-block',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-block.component.html',
})
export class UiBlockComponent {
  @Input() components: UIComponent[] = [];
  @Input() sources: OrchestratorSource[] = [];
  @Input() actions: OrchestratorAction[] = [];
  @Output() actionSelected = new EventEmitter<OrchestratorAction>();

  private readonly seriesPalette = ['#06b6d4', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#38bdf8'];

  constructor(private sanitizer: DomSanitizer) {}

  public seriesColor(index: number): string {
    return this.seriesPalette[index % this.seriesPalette.length];
  }

  public renderMarkdown(content: string): string {
    if (!content) return '';
    const rawHtml = marked.parse(content, { async: false }) as string;
    const cleanHtml = DOMPurify.sanitize(rawHtml);
    return this.sanitizer.sanitize(SecurityContext.HTML, cleanHtml) ?? '';
  }

  /**
   * Maps a weather condition string to an emoji + a Tailwind animation
   * utility (pulse/bounce - the only two of Tailwind's four built-in
   * keyframe animations that read as "weather" rather than "loading
   * spinner"; no custom keyframes needed). Matched by keyword rather than
   * exact string so it stays correct however the description was phrased,
   * whether from get_weather's own WMO_CONDITIONS wording (weather.ts) or
   * a differently-worded fallback source.
   */
  public weatherIcon(condition: string): { emoji: string; anim: string } {
    const c = (condition || '').toLowerCase();
    if (c.includes('thunder')) return { emoji: '⛈️', anim: 'animate-pulse' };
    if (c.includes('freezing') || c.includes('sleet')) return { emoji: '🌨️', anim: 'animate-bounce' };
    if (c.includes('snow')) return { emoji: '❄️', anim: 'animate-pulse' };
    if (c.includes('drizzle') || c.includes('shower')) return { emoji: '🌦️', anim: 'animate-bounce' };
    if (c.includes('rain')) return { emoji: '🌧️', anim: 'animate-bounce' };
    if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return { emoji: '🌫️', anim: '' };
    if (c.includes('overcast')) return { emoji: '☁️', anim: '' };
    if (c.includes('cloud')) return { emoji: '⛅', anim: '' };
    if (c.includes('clear') || c.includes('sun')) return { emoji: '☀️', anim: 'animate-pulse' };
    return { emoji: '🌡️', anim: '' };
  }

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

  public osmLink(lat: number, lng: number, zoom = 12): string {
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;
  }

  public formatBytes(bytes?: number): string {
    if (!bytes || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${value.toFixed(value < 10 && unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
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

  /** 12h/am-pm label from an Open-Meteo hourly ISO timestamp ("...T15:00" -> "3pm"). */
  private formatHour(iso: string): string {
    const match = iso.match(/T(\d{2}):/);
    if (!match) return '';
    let hour = parseInt(match[1], 10);
    const suffix = hour >= 12 ? 'pm' : 'am';
    hour = hour % 12 || 12;
    return `${hour}${suffix}`;
  }

  public weatherHourlyPoints(hourly?: WeatherHourlyPoint[]): string {
    if (!hourly || hourly.length === 0) return '';
    const temps = hourly.map((h) => h.temperature);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const range = max === min ? 1 : max - min;
    const step = this.xStep(hourly.length);
    return hourly.map((h, i) => `${this.pad + i * step},${this.toY(h.temperature, min, min + range)}`).join(' ');
  }

  public weatherHourlyMarkers(hourly?: WeatherHourlyPoint[]): Array<{ x: number; y: number; temp: number; label: string }> {
    if (!hourly || hourly.length === 0) return [];
    const temps = hourly.map((h) => h.temperature);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const range = max === min ? 1 : max - min;
    const step = this.xStep(hourly.length);
    return hourly.map((h, i) => ({
      x: this.pad + i * step,
      y: this.toY(h.temperature, min, min + range),
      temp: h.temperature,
      label: this.formatHour(h.time),
    }));
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
