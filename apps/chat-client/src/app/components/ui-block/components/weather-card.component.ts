import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WeatherCardData, WeatherHourlyPoint } from '@chat-monorepo/shared';

/** Renders a WEATHER_CARD UIComponent, including the hourly-trend sparkline. */
@Component({
  selector: 'app-ui-weather-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './weather-card.component.html',
  host: { style: 'display: contents' },
})
export class WeatherCardComponent {
  @Input({ required: true }) data!: WeatherCardData;

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

  // --- Hourly-trend geometry (SVG viewBox is 0 0 300 120; unitless numbers below map 1:1 to it) ---

  private readonly chartW = 300;
  private readonly chartH = 120;
  private readonly pad = 12;

  private xStep(count: number): number {
    return count > 1 ? (this.chartW - 2 * this.pad) / (count - 1) : 0;
  }

  private toY(value: number, min: number, max: number): number {
    return this.pad + (this.chartH - 2 * this.pad) * (1 - (value - min) / (max - min));
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
}
