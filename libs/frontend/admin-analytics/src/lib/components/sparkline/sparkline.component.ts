import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';

/**
 * The trend slot of a stat tile: a bare 12-ish point sparkline, no axes, no
 * gridlines, no interaction.
 *
 * Per the dataviz stat-tile contract, a sparkline is *shape only* - it answers
 * "which way is this going" at a glance and deliberately cannot be read for a
 * value. The exact numbers live in the tile's own figure and, day by day, in
 * the main time-series chart and its table twin directly below, so nothing is
 * gated behind a mark too small to hover.
 *
 * It is therefore `aria-hidden` and unfocusable on purpose: a screen reader
 * announcing "line chart" for a decorative 96x28 shape that restates the number
 * beside it is noise, not access.
 *
 * Colour: the trailing edge (most recent point) wears the accent; the run-up
 * wears a de-emphasis grey. That is the tile's one job - locate "now" against
 * where it came from - and it keeps a page of six tiles from turning into six
 * competing cyan shapes.
 */
@Component({
  selector: 'lib-sparkline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + W + ' ' + H"
      class="w-full h-full overflow-visible"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      @if (path()) {
        <path [attr.d]="areaPath()" [attr.fill]="'url(#' + gradientId() + ')'" />
        <defs>
          <linearGradient [attr.id]="gradientId()" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" [attr.stop-color]="color()" stop-opacity="0.22" />
            <stop offset="100%" [attr.stop-color]="color()" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path
          [attr.d]="path()"
          fill="none"
          [attr.stroke]="color()"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
        @if (lastPoint(); as last) {
          <circle [attr.cx]="last.x" [attr.cy]="last.y" r="2.4" [attr.fill]="color()" />
        }
      }
    </svg>
  `,
})
export class SparklineComponent {
  public readonly values = input.required<number[]>();
  /** The mark hue. Callers pass the accent for the hero tile, grey elsewhere. */
  public readonly color = input('#475569');

  public readonly W = 120;
  public readonly H = 32;
  private readonly PAD = 3;

  /** Unique per instance so several sparklines' gradients can't collide. */
  private static seq = 0;
  private readonly instanceId = `spark-${SparklineComponent.seq++}`;
  public gradientId(): string {
    return this.instanceId;
  }

  /**
   * The last 24 points at most. A 90-day window drawn into 120px would put
   * ~1.3px between days, which is texture rather than trend.
   */
  private readonly series = computed(() => {
    const all = this.values();
    return all.length > 24 ? all.slice(all.length - 24) : all;
  });

  private readonly plotted = computed(() => {
    const data = this.series();
    if (data.length < 2) return [];

    const max = Math.max(...data);
    const min = Math.min(...data);
    // A flat series has no range to scale against; draw it down the middle
    // rather than dividing by zero or pinning it to the floor.
    const span = max - min || 1;
    const usableH = this.H - this.PAD * 2;
    const step = (this.W - this.PAD * 2) / (data.length - 1);

    return data.map((value, i) => ({
      x: this.PAD + step * i,
      y: max === min ? this.H / 2 : this.PAD + usableH - ((value - min) / span) * usableH,
    }));
  });

  public readonly path = computed(() =>
    this.plotted()
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ')
  );

  public readonly areaPath = computed(() => {
    const pts = this.plotted();
    if (pts.length < 2) return '';
    return `${this.path()} L${pts[pts.length - 1].x.toFixed(1)},${this.H} L${pts[0].x.toFixed(1)},${this.H} Z`;
  });

  public readonly lastPoint = computed(() => {
    const pts = this.plotted();
    return pts.length ? pts[pts.length - 1] : null;
  });
}
