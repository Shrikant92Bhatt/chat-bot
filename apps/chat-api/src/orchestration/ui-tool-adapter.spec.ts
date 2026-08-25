import { describe, it, expect } from 'vitest';
import { normalizeToolResultForUi, TOOL_UI_COMPONENT_MAP } from './ui-tool-adapter';

describe('ui-tool-adapter: normalizing raw tool output into UI components', () => {
  it('maps only the two tools with an approved structured component', () => {
    expect(TOOL_UI_COMPONENT_MAP.get_weather).toBe('WEATHER_CARD');
    expect(TOOL_UI_COMPONENT_MAP.get_stock_quote).toBe('STOCK_CARD');
    expect(TOOL_UI_COMPONENT_MAP.web_search).toBeUndefined();
  });

  it('returns null for a tool with no mapping, even on well-formed JSON', () => {
    expect(normalizeToolResultForUi('web_search', JSON.stringify({ available: true }))).toBeNull();
  });

  it('normalizes a successful get_weather result into WEATHER_CARD data', () => {
    const raw = JSON.stringify({
      success: true,
      location: 'Pune, Maharashtra, India',
      current: { temperature: 27, condition: 'Partly cloudy', humidity: 60, windSpeed: 12 },
      forecast: [{ date: '2026-08-25', temperatureHigh: 30, temperatureLow: 22, condition: 'Clear sky', precipitationProbability: 5 }],
      hourly: [{ time: '2026-08-25T15:00', temperature: 28 }],
    });

    const result = normalizeToolResultForUi('get_weather', raw);
    expect(result).toEqual({
      componentType: 'WEATHER_CARD',
      data: {
        location: 'Pune, Maharashtra, India',
        current: { temperature: 27, condition: 'Partly cloudy', humidity: 60, windSpeed: 12 },
        forecast: [{ date: '2026-08-25', temperatureHigh: 30, temperatureLow: 22, condition: 'Clear sky', precipitationProbability: 5 }],
        hourly: [{ time: '2026-08-25T15:00', temperature: 28 }],
      },
    });
  });

  it('normalizes a successful get_stock_quote result into STOCK_CARD data', () => {
    const raw = JSON.stringify({
      success: true,
      symbol: 'AAPL',
      name: 'Apple Inc.',
      price: 227.5,
      change: -1.2,
      changePercent: -0.52,
      currency: 'USD',
    });

    const result = normalizeToolResultForUi('get_stock_quote', raw);
    expect(result).toEqual({
      componentType: 'STOCK_CARD',
      data: { symbol: 'AAPL', name: 'Apple Inc.', price: 227.5, change: -1.2, changePercent: -0.52, currency: 'USD' },
    });
  });

  it('surfaces the tool-reported error message on a {success:false} result', () => {
    const raw = JSON.stringify({ success: false, error: 'Could not find a location matching "Nowhereville".' });
    const result = normalizeToolResultForUi('get_weather', raw);
    expect(result).toEqual({ componentType: 'WEATHER_CARD', error: 'Could not find a location matching "Nowhereville".' });
  });

  it('fails closed with a generic error on unparseable JSON rather than throwing', () => {
    const result = normalizeToolResultForUi('get_stock_quote', 'not json at all');
    expect(result).toEqual({
      componentType: 'STOCK_CARD',
      error: 'The tool returned a response that could not be read.',
    });
  });

  it('fails closed when a successful result is missing required fields', () => {
    const raw = JSON.stringify({ success: true, location: 'Pune' /* no current */ });
    const result = normalizeToolResultForUi('get_weather', raw);
    expect(result).toEqual({
      componentType: 'WEATHER_CARD',
      error: 'The tool returned data in an unexpected shape.',
    });
  });
});
