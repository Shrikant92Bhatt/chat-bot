import { describe, it, expect } from 'vitest';
import { ChartBlockComponent } from './chart-block.component';
import { ChartData } from '@chat-monorepo/shared';

function makeComponent(): ChartBlockComponent {
  return new ChartBlockComponent();
}

describe('ChartBlockComponent', () => {
  describe('hasData', () => {
    it('is false when there are zero series', () => {
      const c = makeComponent();
      const data: ChartData = { chartType: 'line', xAxis: [], series: [] };
      expect(c.hasData(data)).toBe(false);
    });

    it('is false when every series has an empty data array', () => {
      const c = makeComponent();
      const data: ChartData = {
        chartType: 'bar',
        xAxis: ['a', 'b'],
        series: [{ name: 'A', data: [] }, { name: 'B', data: [] }],
      };
      expect(c.hasData(data)).toBe(false);
    });

    it('is true when at least one series has values', () => {
      const c = makeComponent();
      const data: ChartData = {
        chartType: 'bar',
        xAxis: ['a'],
        series: [{ name: 'A', data: [] }, { name: 'B', data: [5] }],
      };
      expect(c.hasData(data)).toBe(true);
    });
  });

  describe('valueRange', () => {
    it('falls back to a 0..1 range when there is no data', () => {
      const c = makeComponent();
      const data: ChartData = { chartType: 'bar', xAxis: [], series: [] };
      expect(c.valueRange(data)).toEqual({ min: 0, max: 1 });
    });

    it('bar charts are always zero-based, never truncated above zero', () => {
      const c = makeComponent();
      const data: ChartData = {
        chartType: 'bar',
        xAxis: ['a', 'b', 'c'],
        series: [{ name: 'A', data: [100, 105, 110] }],
      };
      const range = c.valueRange(data);
      expect(range.min).toBe(0);
      expect(range.max).toBe(110);
    });

    it('bar charts with negative values keep zero inside the domain', () => {
      const c = makeComponent();
      const data: ChartData = {
        chartType: 'bar',
        xAxis: ['a', 'b'],
        series: [{ name: 'A', data: [-5, -2] }],
      };
      const range = c.valueRange(data);
      expect(range.min).toBe(-5);
      expect(range.max).toBe(0);
    });

    it('area charts are zero-based like bar charts', () => {
      const c = makeComponent();
      const data: ChartData = {
        chartType: 'area',
        xAxis: ['a', 'b'],
        series: [{ name: 'A', data: [50, 60] }],
      };
      const range = c.valueRange(data);
      expect(range.min).toBe(0);
      expect(range.max).toBe(60);
    });

    it('line charts autoscale to local min/max instead of forcing zero', () => {
      const c = makeComponent();
      const data: ChartData = {
        chartType: 'line',
        xAxis: ['a', 'b', 'c'],
        series: [{ name: 'A', data: [100, 105, 110] }],
      };
      const range = c.valueRange(data);
      // A forced-zero domain would put min at 0; autoscaling keeps it near the data.
      expect(range.min).toBeGreaterThan(50);
      expect(range.max).toBeLessThan(150);
      expect(range.min).toBeLessThan(100);
      expect(range.max).toBeGreaterThan(110);
    });

    it('scatter charts autoscale like line charts', () => {
      const c = makeComponent();
      const data: ChartData = {
        chartType: 'scatter',
        xAxis: ['a', 'b'],
        series: [{ name: 'A', data: [200, 210] }],
      };
      const range = c.valueRange(data);
      expect(range.min).toBeGreaterThan(0);
    });

    it('pads a flat single-value series so it is not glued to an edge', () => {
      const c = makeComponent();
      const data: ChartData = {
        chartType: 'line',
        xAxis: ['a', 'b'],
        series: [{ name: 'A', data: [5, 5] }],
      };
      const range = c.valueRange(data);
      expect(range.min).toBeLessThan(5);
      expect(range.max).toBeGreaterThan(5);
    });
  });

  describe('barRects', () => {
    it('draws positive bars upward from the zero baseline', () => {
      const c = makeComponent();
      const data: ChartData = {
        chartType: 'bar',
        xAxis: ['a'],
        series: [{ name: 'A', data: [10] }],
      };
      const [bar] = c.barRects(data);
      const zeroY = c['toY'](0, c.valueRange(data));
      expect(bar.y).toBeLessThan(zeroY);
      expect(bar.height).toBeCloseTo(zeroY - bar.y, 5);
    });

    it('draws negative bars downward from the zero baseline, not from the plot bottom', () => {
      const c = makeComponent();
      const data: ChartData = {
        chartType: 'bar',
        xAxis: ['a', 'b'],
        series: [{ name: 'A', data: [-10, 5] }],
      };
      const [negBar, posBar] = c.barRects(data);
      const range = c.valueRange(data);
      const zeroY = c['toY'](0, range);
      // The negative bar's top edge is at the zero line, not at the axis bottom.
      expect(negBar.y).toBeCloseTo(zeroY, 5);
      expect(negBar.height).toBeGreaterThan(0);
      // The positive bar's bottom edge (y + height) sits at the zero line too.
      expect(posBar.y + posBar.height).toBeCloseTo(zeroY, 5);
    });

    it('carries the series name and a stable key for tooltip wiring', () => {
      const c = makeComponent();
      const data: ChartData = {
        chartType: 'bar',
        xAxis: ['a'],
        series: [{ name: 'Revenue', data: [10] }],
      };
      const [bar] = c.barRects(data);
      expect(bar.seriesName).toBe('Revenue');
      expect(bar.key).toBe('bar-0-0');
    });
  });

  describe('formatTick', () => {
    it('renders integers without decimals', () => {
      expect(makeComponent().formatTick(42)).toBe('42');
    });

    it('abbreviates thousands and millions', () => {
      const c = makeComponent();
      expect(c.formatTick(1500)).toBe('1.5K');
      expect(c.formatTick(2_500_000)).toBe('2.5M');
    });

    it('handles non-finite input without throwing', () => {
      expect(makeComponent().formatTick(NaN)).toBe('0');
    });
  });

  describe('xAxisTicks', () => {
    it('thins a long category list to at most 6 labels, always keeping the last', () => {
      const c = makeComponent();
      const xAxis = Array.from({ length: 20 }, (_, i) => `d${i}`);
      const data: ChartData = {
        chartType: 'line',
        xAxis,
        series: [{ name: 'A', data: xAxis.map(() => 1) }],
      };
      const ticks = c.xAxisTicks(data);
      expect(ticks.length).toBeLessThanOrEqual(6);
      expect(ticks[ticks.length - 1].label).toBe('d19');
    });

    it('returns nothing for an empty category axis', () => {
      const c = makeComponent();
      const data: ChartData = { chartType: 'line', xAxis: [], series: [] };
      expect(c.xAxisTicks(data)).toEqual([]);
    });
  });

  describe('chartSummary', () => {
    it('describes an empty chart explicitly', () => {
      const c = makeComponent();
      const data: ChartData = { chartType: 'bar', title: 'Revenue', xAxis: [], series: [] };
      expect(c.chartSummary(data)).toBe('Revenue. Bar chart with no data to display.');
    });

    it('states chart type, series count and value range for populated data', () => {
      const c = makeComponent();
      const data: ChartData = {
        chartType: 'line',
        xAxis: ['a', 'b'],
        series: [{ name: 'A', data: [3, 87] }],
      };
      const summary = c.chartSummary(data);
      expect(summary).toContain('Line chart');
      expect(summary).toContain('1 series');
      expect(summary).toContain('3');
      expect(summary).toContain('87');
    });
  });

  describe('tooltip interaction', () => {
    it('starts with no active tooltip', () => {
      expect(makeComponent().tooltip()).toBeNull();
    });

    it('showTooltip sets the tooltip state with a clamped x percentage', () => {
      const c = makeComponent();
      c.showTooltip('cat-0', 0, 'Jan', [{ label: 'Revenue', value: '10', color: '#06b6d4' }]);
      const t = c.tooltip();
      expect(t).not.toBeNull();
      expect(t?.heading).toBe('Jan');
      // Clamped away from the exact edge so the tooltip never hangs off the chart.
      expect(t?.xPct).toBeGreaterThanOrEqual(8);
    });

    it('toggleTooltip dismisses the tooltip on a second tap of the same mark', () => {
      const c = makeComponent();
      c.toggleTooltip('bar-0-0', 50, 'a', [{ label: 'A', value: '10', color: '#06b6d4' }]);
      expect(c.tooltip()).not.toBeNull();
      c.toggleTooltip('bar-0-0', 50, 'a', [{ label: 'A', value: '10', color: '#06b6d4' }]);
      expect(c.tooltip()).toBeNull();
    });

    it('toggleTooltip on a different mark replaces rather than dismisses', () => {
      const c = makeComponent();
      c.toggleTooltip('bar-0-0', 50, 'a', [{ label: 'A', value: '10', color: '#06b6d4' }]);
      c.toggleTooltip('bar-0-1', 60, 'b', [{ label: 'A', value: '20', color: '#06b6d4' }]);
      expect(c.tooltip()?.key).toBe('bar-0-1');
    });

    it('hideTooltip clears the state', () => {
      const c = makeComponent();
      c.showTooltip('cat-0', 0, 'Jan', []);
      c.hideTooltip();
      expect(c.tooltip()).toBeNull();
    });
  });

  describe('hoverBands', () => {
    it('produces one band per category, each carrying every series value at that index', () => {
      const c = makeComponent();
      const data: ChartData = {
        chartType: 'line',
        xAxis: ['Jan', 'Feb'],
        series: [
          { name: 'A', data: [1, 2] },
          { name: 'B', data: [3, 4] },
        ],
      };
      const bands = c.hoverBands(data);
      expect(bands).toHaveLength(2);
      expect(bands[0].heading).toBe('Jan');
      expect(bands[0].lines).toEqual([
        { label: 'A', value: '1', color: c.seriesColor(0) },
        { label: 'B', value: '3', color: c.seriesColor(1) },
      ]);
    });
  });
});
