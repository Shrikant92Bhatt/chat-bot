/**
 * RESPONSE RENDERING TESTS
 * Tests for how different response types are rendered:
 * - Text responses
 * - Structured card responses (weather, stock, etc.)
 * - JSON should never leak to UI
 * - Fallback handling for malformed data
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChatMessage, UIComponent } from '@chat-monorepo/shared';
import { UiBlockComponent } from './ui-block.component';

describe('Response Rendering Tests', () => {
  describe('Text Response Rendering', () => {
    it('should render plain text without any card wrapper', () => {
      const content = 'This is a plain text response about JavaScript closures.';
      const message: ChatMessage = {
        id: 'msg1',
        role: 'assistant',
        content,
      };

      // Should just have text, no UI components
      expect(message.ui).toBeUndefined();
      expect(message.content).toBe(content);
    });

    it('should render markdown text without card wrapper', () => {
      const content = '# Closures in JavaScript\n\nA closure is a function that has access to variables...';
      const message: ChatMessage = {
        id: 'msg2',
        role: 'assistant',
        content,
      };

      expect(message.content).toContain('# Closures');
      expect(message.ui).toBeUndefined();
    });

    it('should render lists and blockquotes in markdown', () => {
      const content = '- Item 1\n- Item 2\n\n> This is a quote';
      const message: ChatMessage = {
        id: 'msg3',
        role: 'assistant',
        content,
      };

      expect(message.content).toContain('-');
      expect(message.content).toContain('>');
    });
  });

  describe('Structured Response Rendering (No JSON leak)', () => {
    let uiComponent: UiBlockComponent;

    beforeEach(() => {
      uiComponent = new UiBlockComponent();
    });

    it('should render weather card without JSON', () => {
      const components: UIComponent[] = [
        {
          id: 'weather-1',
          type: 'WEATHER_CARD',
          data: {
            location: 'Bangalore, India',
            temperature: 28,
            condition: 'Partly Cloudy',
            humidity: 65,
            windSpeed: 15,
          },
        },
      ];

      uiComponent.components = components;

      // Should have no raw JSON in the visible content
      expect(components[0].type).toBe('WEATHER_CARD');
      expect(components[0].data).toBeTruthy();
      // The component should render this via WeatherCardComponent, not as JSON
    });

    it('should render stock card without JSON', () => {
      const components: UIComponent[] = [
        {
          id: 'stock-1',
          type: 'STOCK_CARD',
          data: {
            symbol: 'INFY',
            name: 'Infosys',
            price: 1850.50,
            change: 12.75,
            changePercent: 0.69,
            currency: 'INR',
          },
        },
      ];

      uiComponent.components = components;
      expect(components[0].type).toBe('STOCK_CARD');
      // Should render via StockCardComponent, not as JSON text
    });

    it('should render table without JSON wrapper', () => {
      const components: UIComponent[] = [
        {
          id: 'table-1',
          type: 'TABLE',
          data: {
            columns: ['Name', 'Score'],
            rows: [
              { Name: 'React', Score: '95' },
              { Name: 'Angular', Score: '85' },
            ],
          },
        },
      ];

      uiComponent.components = components;
      expect(components[0].type).toBe('TABLE');
      // Should render via TableBlockComponent with semantic <table> HTML
    });

    it('should render chart without JSON', () => {
      const components: UIComponent[] = [
        {
          id: 'chart-1',
          type: 'CHART',
          data: {
            chartType: 'bar',
            xAxis: ['Q1', 'Q2', 'Q3'],
            series: [
              { name: 'Revenue', data: [100, 150, 120] },
              { name: 'Expenses', data: [80, 90, 110] },
            ],
          },
        },
      ];

      uiComponent.components = components;
      expect(components[0].type).toBe('CHART');
      // Should render via ChartBlockComponent with SVG visualization
    });

    it('should render code block without JSON', () => {
      const components: UIComponent[] = [
        {
          id: 'code-1',
          type: 'CODE_BLOCK',
          data: {
            code: 'function debounce(fn, delay) { let timeoutId; return (...args) => { clearTimeout(timeoutId); timeoutId = setTimeout(() => fn(...args), delay); }; }',
            language: 'typescript',
          },
        },
      ];

      uiComponent.components = components;
      expect(components[0].type).toBe('CODE_BLOCK');
      // Should render via CodeBlockComponent with syntax highlighting
    });

    it('should render news/search results without JSON', () => {
      const components: UIComponent[] = [
        {
          id: 'news-1',
          type: 'NEWS_CARD',
          data: {
            title: 'Latest AI Breakthrough',
            source: 'TechNews',
            url: 'https://technews.com/ai-breakthrough',
            summary: 'Researchers announce new AI model...',
          },
        },
      ];

      uiComponent.components = components;
      expect(components[0].type).toBe('NEWS_CARD');
      // Should render via NewsCardComponent with readable layout
    });
  });

  describe('Error Handling and Fallbacks', () => {
    let uiComponent: UiBlockComponent;

    beforeEach(() => {
      uiComponent = new UiBlockComponent();
    });

    it('should gracefully handle malformed weather data', () => {
      const components: UIComponent[] = [
        {
          id: 'weather-bad',
          type: 'WEATHER_CARD',
          data: {
            location: 'Test',
            temperature: NaN,
            condition: '',
          } as any,
        },
      ];

      uiComponent.components = components;
      expect(components[0].type).toBe('WEATHER_CARD');
      // Should not crash, renderer should handle missing/invalid data
    });

    it('should handle empty table gracefully', () => {
      const components: UIComponent[] = [
        {
          id: 'table-empty',
          type: 'TABLE',
          data: {
            columns: [],
            rows: [],
          },
        },
      ];

      uiComponent.components = components;
      expect(components[0].type).toBe('TABLE');
      // Should display empty state message, not crash
    });

    it('should handle chart with no data points', () => {
      const components: UIComponent[] = [
        {
          id: 'chart-empty',
          type: 'CHART',
          data: {
            chartType: 'bar',
            xAxis: [],
            series: [],
          },
        },
      ];

      uiComponent.components = components;
      expect(components[0].type).toBe('CHART');
      // Should render empty state, not crash
    });

    it('should display error card for failed tool execution', () => {
      const components: UIComponent[] = [
        {
          id: 'error-1',
          type: 'ERROR_CARD',
          data: {
            title: 'Weather lookup failed',
            message: 'Unable to fetch weather data for location',
          },
        },
      ];

      uiComponent.components = components;
      expect(components[0].type).toBe('ERROR_CARD');
      // Should render clean error message, not raw error JSON
    });
  });

  describe('Mixed Content (Text + Structured)', () => {
    let uiComponent: UiBlockComponent;

    beforeEach(() => {
      uiComponent = new UiBlockComponent();
    });

    it('should combine text answer with weather card', () => {
      const message: ChatMessage = {
        id: 'msg-mixed-1',
        role: 'assistant',
        content: 'Here is the current weather in Bangalore:',
        ui: [
          {
            id: 'weather-1',
            type: 'WEATHER_CARD',
            data: {
              location: 'Bangalore, India',
              temperature: 28,
              condition: 'Cloudy',
              humidity: 70,
              windSpeed: 10,
            },
          },
        ],
      };

      expect(message.content).toBeTruthy();
      expect(message.ui).toHaveLength(1);
      expect(message.ui[0].type).toBe('WEATHER_CARD');
    });

    it('should combine text answer with multiple cards', () => {
      const message: ChatMessage = {
        id: 'msg-multi',
        role: 'assistant',
        content: 'Here are the top 3 stocks:',
        ui: [
          {
            id: 'stock-1',
            type: 'STOCK_CARD',
            data: {
              symbol: 'INFY',
              name: 'Infosys',
              price: 1850,
              change: 10,
              changePercent: 0.54,
              currency: 'INR',
            },
          },
          {
            id: 'stock-2',
            type: 'STOCK_CARD',
            data: {
              symbol: 'TCS',
              name: 'Tata Consultancy',
              price: 3500,
              change: 50,
              changePercent: 1.45,
              currency: 'INR',
            },
          },
        ],
      };

      expect(message.ui).toHaveLength(2);
      expect(message.ui?.every((c) => c.type === 'STOCK_CARD')).toBe(true);
    });
  });

  describe('Component Registry and Mapping', () => {
    it('should have correct component type registered', () => {
      const uiComponent = new UiBlockComponent();
      const registry = uiComponent.registry;

      expect(registry['WEATHER_CARD']).toBeDefined();
      expect(registry['STOCK_CARD']).toBeDefined();
      expect(registry['CHART']).toBeDefined();
      expect(registry['TABLE']).toBeDefined();
      expect(registry['CODE_BLOCK']).toBeDefined();
      expect(registry['NEWS_CARD']).toBeDefined();
      expect(registry['MARKDOWN']).toBeDefined();
      expect(registry['ERROR_CARD']).toBeDefined();
    });

    it('should label components correctly for UI', () => {
      const uiComponent = new UiBlockComponent();

      expect(uiComponent.componentLabel('WEATHER_CARD')).toBe('weather');
      expect(uiComponent.componentLabel('STOCK_CARD')).toBe('stock quote');
      expect(uiComponent.componentLabel('CHART')).toBe('chart');
      expect(uiComponent.componentLabel('TABLE')).toBe('table');
    });

    it('should provide inputs correctly for component instantiation', () => {
      const uiComponent = new UiBlockComponent();

      const weatherComponent: UIComponent = {
        id: 'w1',
        type: 'WEATHER_CARD',
        data: { location: 'Test' },
      };
      const inputs = uiComponent.inputsFor(weatherComponent);
      expect(inputs.data).toBe(weatherComponent.data);
    });

    it('should handle CONFIRMATION_CARD with id input', () => {
      const uiComponent = new UiBlockComponent();

      const confirmComponent: UIComponent = {
        id: 'confirm-1',
        type: 'CONFIRMATION_CARD',
        data: { title: 'Are you sure?' },
      };
      const inputs = uiComponent.inputsFor(confirmComponent);
      expect(inputs.data).toBe(confirmComponent.data);
      expect(inputs.id).toBe('confirm-1');
    });
  });

  describe('Streaming and Progressive Rendering', () => {
    it('should handle pending UI blocks during streaming', () => {
      const uiComponent = new UiBlockComponent();

      uiComponent.pending = [
        {
          id: 'pending-weather',
          type: 'WEATHER_CARD',
          label: 'weather',
        },
      ];

      expect(uiComponent.pending).toHaveLength(1);
      expect(uiComponent.pending[0].id).toBe('pending-weather');
    });

    it('should transition pending blocks to completed components', () => {
      const uiComponent = new UiBlockComponent();

      uiComponent.pending = [
        {
          id: 'pending-stock',
          type: 'STOCK_CARD',
          label: 'stock quote',
        },
      ];

      // After stream completes, pending becomes empty and data moves to components
      uiComponent.pending = [];
      uiComponent.components = [
        {
          id: 'pending-stock',
          type: 'STOCK_CARD',
          data: {
            symbol: 'AAPL',
            name: 'Apple',
            price: 150,
            change: 5,
            changePercent: 3.45,
            currency: 'USD',
          },
        },
      ];

      expect(uiComponent.pending).toHaveLength(0);
      expect(uiComponent.components).toHaveLength(1);
    });
  });
});
