import { UIComponentType, WeatherCardData, StockCardData, ChartData, TableData, NewsCardData } from '@chat-monorepo/shared';

/**
 * Type-safe response discriminator that determines the appropriate UI component type
 * for structured responses. Prevents raw JSON from reaching the UI by validating
 * structure and content before rendering.
 *
 * This module provides:
 * - Type guards for all structured response types
 * - Auto-detection logic for determining response types
 * - Defensive parsing with safe fallbacks
 * - Comprehensive validation against malformed input
 */

/**
 * Type guard for WeatherCardData - ensures all required fields are present with correct types.
 */
export function isWeatherCardData(data: unknown): data is WeatherCardData {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.location === 'string' &&
    !!obj.current &&
    typeof obj.current === 'object' &&
    typeof (obj.current as Record<string, unknown>).temperature === 'number' &&
    typeof (obj.current as Record<string, unknown>).condition === 'string' &&
    typeof (obj.current as Record<string, unknown>).humidity === 'number' &&
    typeof (obj.current as Record<string, unknown>).windSpeed === 'number'
  );
}

/**
 * Type guard for StockCardData - ensures all required fields are present with correct types.
 */
export function isStockCardData(data: unknown): data is StockCardData {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.symbol === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.price === 'number' &&
    typeof obj.change === 'number' &&
    typeof obj.changePercent === 'number' &&
    typeof obj.currency === 'string'
  );
}

/**
 * Type guard for ChartData - validates chart structure and data arrays.
 */
export function isChartData(data: unknown): data is ChartData {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if (!['line', 'bar', 'pie', 'area', 'scatter'].includes(obj.chartType as string)) return false;
  if (!Array.isArray(obj.xAxis) || obj.xAxis.length === 0) return false;
  if (!Array.isArray(obj.series) || obj.series.length === 0) return false;
  return obj.series.every(
    (s) => typeof s === 'object' && typeof (s as Record<string, unknown>).name === 'string' && Array.isArray((s as Record<string, unknown>).data)
  );
}

/**
 * Type guard for TableData - validates table structure with columns and rows.
 */
export function isTableData(data: unknown): data is TableData {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.columns) || obj.columns.length === 0) return false;
  if (!Array.isArray(obj.rows)) return false;
  return obj.columns.every((c) => typeof c === 'string') && obj.rows.every((r) => Array.isArray(r));
}

/**
 * Type guard for NewsCardData - validates articles structure.
 */
export function isNewsCardData(data: unknown): data is NewsCardData {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.articles) || obj.articles.length === 0) return false;
  return obj.articles.every(
    (a) =>
      typeof a === 'object' &&
      typeof (a as Record<string, unknown>).title === 'string'
  );
}

/**
 * Detects if raw data contains weather-like structure based on field patterns.
 * Returns true if data contains weather-specific fields.
 */
export function detectWeatherResponse(data: unknown): boolean {
  if (!isWeatherCardData(data)) return false;
  return true;
}

/**
 * Detects if raw data contains stock-like structure based on field patterns.
 * Returns true if data contains stock-specific fields.
 */
export function detectStockResponse(data: unknown): boolean {
  if (!isStockCardData(data)) return false;
  return true;
}

/**
 * Detects if raw data contains chart-like structure.
 * Returns true if data has chart configuration fields.
 */
export function detectChartResponse(data: unknown): boolean {
  if (!isChartData(data)) return false;
  return true;
}

/**
 * Detects if raw data contains table-like structure.
 * Returns true if data has columns and rows arrays.
 */
export function detectTableResponse(data: unknown): boolean {
  if (!isTableData(data)) return false;
  return true;
}

/**
 * Detects if raw data contains news-like structure.
 * Returns true if data contains an articles array with titles.
 */
export function detectNewsResponse(data: unknown): boolean {
  if (!isNewsCardData(data)) return false;
  return true;
}

/**
 * Attempt to auto-detect the UIComponentType for a given data object.
 * Tries multiple detection strategies in priority order.
 * Returns null if no match is found.
 */
export function autoDetectComponentType(data: unknown): UIComponentType | null {
  if (detectWeatherResponse(data)) return 'WEATHER_CARD';
  if (detectStockResponse(data)) return 'STOCK_CARD';
  if (detectChartResponse(data)) return 'CHART';
  if (detectTableResponse(data)) return 'TABLE';
  if (detectNewsResponse(data)) return 'NEWS_CARD';
  return null;
}

/**
 * Safely extracts JSON from text, handling partial/malformed JSON.
 * Returns null if no valid JSON object is found.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text || typeof text !== 'string') return null;

  // Look for JSON object patterns: { ... }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch (e) {
    // JSON parse failed, try next strategy
  }

  // Try to find a valid JSON object by incrementally removing trailing chars
  // (in case the object is incomplete)
  let attempt = jsonMatch[0];
  while (attempt.length > 2) {
    attempt = attempt.slice(0, -1);
    try {
      const parsed = JSON.parse(attempt);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch (e) {
      // Continue trying
    }
  }

  return null;
}

/**
 * Defensive response processor that attempts to parse and validate structured data.
 * Returns a tuple of [isValid, normalizedData, componentType, errorMessage].
 *
 * This is the main entry point for processing potentially-malformed responses.
 */
export function processStructuredResponse(
  rawData: unknown
): { valid: boolean; data?: unknown; componentType?: UIComponentType; error?: string } {
  // Early exit for obviously-invalid input
  if (rawData === null || rawData === undefined) {
    return { valid: false, error: 'Response data is empty' };
  }

  // If already an object, try detection directly
  if (typeof rawData === 'object') {
    const componentType = autoDetectComponentType(rawData);
    if (componentType) {
      return { valid: true, data: rawData, componentType };
    }
  }

  // If it's a string, try to extract and parse JSON
  if (typeof rawData === 'string') {
    const extracted = extractJsonObject(rawData);
    if (extracted) {
      const componentType = autoDetectComponentType(extracted);
      if (componentType) {
        return { valid: true, data: extracted, componentType };
      }
      return { valid: false, error: 'Extracted JSON did not match any known response type' };
    }
    return { valid: false, error: 'Could not extract valid JSON from response' };
  }

  return { valid: false, error: 'Response type not recognized' };
}

/**
 * Field names that commonly appear in structured responses we care about.
 * Used by leak detection (tool-leak-stream-filter.ts) to identify potential
 * JSON objects that should not appear in visible text.
 */
export const STRUCTURED_RESPONSE_FIELDS = [
  // Weather fields
  'location',
  'current',
  'humidity',
  'forecast',
  'hourly',
  'windSpeed',
  'temperatureHigh',
  'temperatureLow',
  'precipitationProbability',
  'temperature',
  'condition',

  // Stock fields
  'symbol',
  'changePercent',
  'price',
  'change',
  'currency',

  // Chart/Table fields
  'chartType',
  'xAxis',
  'series',
  'columns',
  'rows',

  // News/Search fields
  'title',
  'link',
  'articles',
  'source',
  'url',
  'publishedAt',

  // API/Tool response fields
  'success',
  'items',
  'results',

  // Research planner output (should NEVER appear in visible text)
  'needsResearch',
  'searchQueries',
  'reasoning',
  'phase',
  'message',

  // Generic structured response fields
  'data',
  'error',
  'status',
] as const;
