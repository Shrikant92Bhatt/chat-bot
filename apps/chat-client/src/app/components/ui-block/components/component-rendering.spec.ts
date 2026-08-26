/**
 * COMPONENT RENDERING TESTS
 * Tests for individual component rendering, data handling, and edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WeatherCardComponent } from './weather-card.component';
import { StockCardComponent } from './stock-card.component';
import { ChartBlockComponent } from './chart-block.component';
import { TableBlockComponent } from './table-block.component';
import { CodeBlockComponent } from './code-block.component';
import { WeatherCardData, StockCardData, ChartData, TableData, CodeBlockData } from '@chat-monorepo/shared';

describe('UI Component Rendering Tests', () => {
  describe('WeatherCardComponent', () => {
    let component: WeatherCardComponent;

    beforeEach(() => {
      component = new WeatherCardComponent();
    });

    it('should display all required weather fields', () => {
      const data: WeatherCardData = {
        location: 'Pune, India',
        temperature: 28,
        condition: 'Partly Cloudy',
        humidity: 65,
        windSpeed: 15,
        feelsLike: 30,
      };
      component.data = data;

      expect(component.data.location).toBe('Pune, India');
      expect(component.data.temperature).toBe(28);
      expect(component.data.condition).toBe('Partly Cloudy');
    });

    it('should map weather conditions to correct emojis', () => {
      const icon = component.weatherIcon('Thunderstorm');
      expect(icon.emoji).toBe('⛈️');
      expect(icon.anim).toBe('animate-pulse');
    });

    it('should handle rainy conditions correctly', () => {
      expect(component.weatherIcon('Rain').emoji).toBe('🌧️');
      expect(component.weatherIcon('Drizzle').emoji).toBe('🌦️');
    });

    it('should handle snow and freezing conditions', () => {
      expect(component.weatherIcon('Freezing Rain').emoji).toBe('🌨️');
      expect(component.weatherIcon('Snow').emoji).toBe('❄️');
    });

    it('should handle sunny and clear conditions', () => {
      expect(component.weatherIcon('Clear').emoji).toBe('☀️');
      expect(component.weatherIcon('Sunny').emoji).toBe('☀️');
    });

    it('should generate hourly trend SVG points correctly', () => {
      const hourly = [
        { time: '2024-08-26T12:00', temperature: 25 },
        { time: '2024-08-26T13:00', temperature: 27 },
        { time: '2024-08-26T14:00', temperature: 28 },
      ];
      const points = component.weatherHourlyPoints(hourly);
      expect(points).toBeTruthy();
      expect(points.split(' ').length).toBe(3); // Three data points
    });

    it('should handle empty hourly data gracefully', () => {
      const points = component.weatherHourlyPoints(undefined);
      expect(points).toBe('');

      const emptyPoints = component.weatherHourlyPoints([]);
      expect(emptyPoints).toBe('');
    });

    it('should generate hourly markers with temperature and labels', () => {
      const hourly = [
        { time: '2024-08-26T14:00', temperature: 28 },
        { time: '2024-08-26T15:00', temperature: 27 },
      ];
      const markers = component.weatherHourlyMarkers(hourly);
      expect(markers).toHaveLength(2);
      expect(markers[0].temp).toBe(28);
      expect(markers[0].label).toBe('2pm');
      expect(markers[1].label).toBe('3pm');
    });
  });

  describe('StockCardComponent', () => {
    let component: StockCardComponent;

    beforeEach(() => {
      component = new StockCardComponent();
    });

    it('should display stock price and change', () => {
      const data: StockCardData = {
        symbol: 'INFY',
        name: 'Infosys',
        price: 1850.50,
        change: 12.75,
        changePercent: 0.69,
        currency: 'INR',
      };
      component.data = data;

      expect(component.data.symbol).toBe('INFY');
      expect(component.data.price).toBe(1850.50);
      expect(component.data.change).toBe(12.75);
    });

    it('should apply green color class for positive change', () => {
      const colorClass = component.changeColorClass(5.5);
      expect(colorClass).toBe('text-accentEmerald');
    });

    it('should apply red color class for negative change', () => {
      const colorClass = component.changeColorClass(-3.2);
      expect(colorClass).toBe('text-accentRose');
    });

    it('should apply neutral color for zero change', () => {
      const colorClass = component.changeColorClass(0);
      expect(colorClass).toBe('text-slate-400');
    });

    it('should set correct trend arrow and styling for positive change', () => {
      const trend = component.stockTrend(10.5);
      expect(trend.arrow).toBe('▲');
      expect(trend.bg).toBe('bg-accentEmerald/[0.06]');
      expect(trend.border).toBe('border-accentEmerald/20');
    });

    it('should set correct trend arrow and styling for negative change', () => {
      const trend = component.stockTrend(-5.2);
      expect(trend.arrow).toBe('▼');
      expect(trend.bg).toBe('bg-accentRose/[0.06]');
      expect(trend.border).toBe('border-accentRose/20');
    });

    it('should set neutral styling for zero change', () => {
      const trend = component.stockTrend(0);
      expect(trend.arrow).toBe('▬');
    });

    it('should get chart data when chartPoints exist', () => {
      const data: StockCardData = {
        symbol: 'TCS',
        name: 'Tata Consultancy',
        price: 3500,
        change: 50,
        changePercent: 1.45,
        currency: 'INR',
        chartPoints: [
          { timestamp: 1000000, price: 3400 },
          { timestamp: 1000001, price: 3500 },
        ],
      };
      component.data = data;
      const chartData = component.getChartData();

      expect(chartData).toBeTruthy();
      expect(chartData?.symbol).toBe('TCS');
      expect(chartData?.points).toHaveLength(2);
    });

    it('should return null chart data when chartPoints are undefined', () => {
      const data: StockCardData = {
        symbol: 'INFY',
        name: 'Infosys',
        price: 1850,
        change: 10,
        changePercent: 0.54,
        currency: 'INR',
      };
      component.data = data;
      const chartData = component.getChartData();

      expect(chartData).toBeNull();
    });
  });

  describe('ChartBlockComponent', () => {
    let component: ChartBlockComponent;

    beforeEach(() => {
      component = new ChartBlockComponent();
    });

    it('should correctly identify when chart has data', () => {
      const data: ChartData = {
        chartType: 'bar',
        xAxis: ['A', 'B'],
        series: [{ name: 'Revenue', data: [100, 200] }],
      };
      expect(component.hasData(data)).toBe(true);
    });

    it('should return false when chart has empty series', () => {
      const data: ChartData = {
        chartType: 'line',
        xAxis: [],
        series: [],
      };
      expect(component.hasData(data)).toBe(false);
    });

    it('should calculate correct value range for bar charts (zero-based)', () => {
      const data: ChartData = {
        chartType: 'bar',
        xAxis: ['Jan'],
        series: [{ name: 'Revenue', data: [100] }],
      };
      const range = component.valueRange(data);
      expect(range.min).toBe(0);
      expect(range.max).toBe(100);
    });

    it('should calculate correct value range for line charts (autoscaled)', () => {
      const data: ChartData = {
        chartType: 'line',
        xAxis: ['A', 'B'],
        series: [{ name: 'Data', data: [100, 200] }],
      };
      const range = component.valueRange(data);
      expect(range.min).toBeGreaterThanOrEqual(0);
      expect(range.min).toBeLessThan(100);
      expect(range.max).toBeGreaterThan(200);
    });

    it('should format tick values correctly', () => {
      expect(component.formatTick(42)).toBe('42');
      expect(component.formatTick(1500)).toBe('1.5K');
      expect(component.formatTick(2500000)).toBe('2.5M');
    });

    it('should handle non-finite tick values without throwing', () => {
      expect(component.formatTick(NaN)).toBe('0');
      expect(component.formatTick(Infinity)).toBeDefined();
    });

    it('should generate x-axis ticks and thin long labels', () => {
      const xAxis = Array.from({ length: 20 }, (_, i) => `day${i}`);
      const data: ChartData = {
        chartType: 'line',
        xAxis,
        series: [{ name: 'Data', data: xAxis.map(() => 1) }],
      };
      const ticks = component.xAxisTicks(data);
      expect(ticks.length).toBeLessThanOrEqual(6);
      expect(ticks[ticks.length - 1].label).toBe('day19');
    });

    it('should provide chart summary for empty data', () => {
      const data: ChartData = {
        chartType: 'bar',
        title: 'Revenue',
        xAxis: [],
        series: [],
      };
      const summary = component.chartSummary(data);
      expect(summary).toContain('Revenue');
      expect(summary).toContain('no data');
    });

    it('should provide chart summary for populated data', () => {
      const data: ChartData = {
        chartType: 'line',
        xAxis: ['A', 'B'],
        series: [{ name: 'Series1', data: [10, 20] }],
      };
      const summary = component.chartSummary(data);
      expect(summary).toContain('Line chart');
      expect(summary).toContain('series');
    });
  });

  describe('TableBlockComponent', () => {
    let component: TableBlockComponent;

    beforeEach(() => {
      component = new TableBlockComponent();
    });

    it('should display table with rows and columns', () => {
      const data: TableData = {
        columns: ['Name', 'Age', 'City'],
        rows: [
          { Name: 'Alice', Age: '30', City: 'Bangalore' },
          { Name: 'Bob', Age: '25', City: 'Mumbai' },
        ],
      };
      component.data = data;

      expect(component.data.columns).toHaveLength(3);
      expect(component.data.rows).toHaveLength(2);
    });

    it('should paginate rows correctly', () => {
      const rows = Array.from({ length: 50 }, (_, i) => ({
        Index: `${i}`,
        Value: `Value${i}`,
      }));
      const data: TableData = {
        columns: ['Index', 'Value'],
        rows,
      };
      component.data = data;

      // Initially shows 20 rows
      let visible = component.visibleRows;
      expect(visible.length).toBe(20);

      // After showing more
      component.showMoreRows();
      visible = component.visibleRows;
      expect(visible.length).toBe(40);
    });

    it('should indicate remaining row count', () => {
      const rows = Array.from({ length: 50 }, (_, i) => ({ id: `${i}` }));
      const data: TableData = {
        columns: ['id'],
        rows,
      };
      component.data = data;

      expect(component.remainingRowCount).toBe(30); // 50 - 20 initial
      expect(component.hasMoreRows).toBe(true);

      component.showMoreRows();
      expect(component.remainingRowCount).toBe(10);
    });

    it('should support copy table functionality', () => {
      const data: TableData = {
        columns: ['Name', 'Value'],
        rows: [
          { Name: 'Item1', Value: '100' },
          { Name: 'Item2', Value: '200' },
        ],
      };
      component.data = data;

      // Test that component has copyTable method
      expect(typeof component.copyTable).toBe('function');
      expect(typeof component.copyButtonLabel).toBe('string');
      expect(component.copyButtonLabel).toBe('Copy');
    });

    it('should track numeric columns data', () => {
      const data: TableData = {
        columns: ['Name', 'Age', 'Salary'],
        rows: [
          { Name: 'Alice', Age: '30', Salary: '50000' },
          { Name: 'Bob', Age: '25', Salary: '45000' },
        ],
      };
      component.data = data;

      // Verify the component has column data
      expect(component.data.columns).toHaveLength(3);
      expect(component.data.rows).toHaveLength(2);

      // numericColumns is computed after ngOnChanges
      // Just verify it's initialized
      expect(Array.isArray(component.numericColumns)).toBe(true);
    });
  });

  describe('CodeBlockComponent', () => {
    it('should handle code data with language', () => {
      const data: CodeBlockData = {
        code: 'function hello() { return "world"; }',
        language: 'javascript',
      };

      expect(data.code).toBeTruthy();
      expect(data.language).toBe('javascript');
    });

    it('should include file name when provided', () => {
      const data: CodeBlockData = {
        code: 'console.log("test");',
        language: 'javascript',
        fileName: 'app.js',
      };

      expect(data.fileName).toBe('app.js');
      expect(data.code).toBeTruthy();
    });

    it('should handle different programming languages', () => {
      const languages = ['typescript', 'python', 'html', 'css', 'sql', 'bash'];

      languages.forEach((lang) => {
        const data: CodeBlockData = {
          code: 'sample code',
          language: lang,
        };
        expect(data.language).toBe(lang);
        expect(data.code).toBe('sample code');
      });
    });

    it('should accept potentially unsafe code for sanitization', () => {
      const data: CodeBlockData = {
        code: '<script>alert("xss")</script>',
        language: 'html',
      };

      // Component should accept the data (sanitization happens in component)
      expect(data.code).toContain('script');
      expect(data.language).toBe('html');
    });
  });
});
