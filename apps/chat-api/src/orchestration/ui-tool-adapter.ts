import { StockCardData, UIComponentType, WeatherCardData } from '@chat-monorepo/shared';
import { isWeatherCardData, isStockCardData } from './response-discriminator';

/**
 * Normalizes a raw MCP tool result into an approved UI component shape.
 *
 * This is the one place a tool's own JSON output turns into a UI-ready
 * payload - the frontend never sees a tool's raw shape, only what this
 * (and orchestration/ui-schema.ts's stricter Zod validation, applied to the
 * model's own ```ui block) explicitly produces. Only tools with an exact,
 * pre-approved component mapping are handled here; every other tool's
 * result still reaches the model as a plain ToolMessage and, if it wants a
 * card for it, goes through the fenced-block path in ui-schema.ts instead.
 */
export const TOOL_UI_COMPONENT_MAP: Readonly<Record<string, UIComponentType>> = {
  get_weather: 'WEATHER_CARD',
  get_stock_quote: 'STOCK_CARD',
};

function normalizeWeather(parsed: Record<string, unknown>): WeatherCardData | null {
  const current = parsed.current as Record<string, unknown> | undefined;
  if (typeof parsed.location !== 'string' || !current) return null;
  if (
    typeof current.temperature !== 'number' ||
    typeof current.condition !== 'string' ||
    typeof current.humidity !== 'number' ||
    typeof current.windSpeed !== 'number'
  ) {
    return null;
  }
  return {
    location: parsed.location,
    current: {
      temperature: current.temperature,
      condition: current.condition,
      humidity: current.humidity,
      windSpeed: current.windSpeed,
    },
    forecast: Array.isArray(parsed.forecast) ? (parsed.forecast as WeatherCardData['forecast']) : undefined,
    hourly: Array.isArray(parsed.hourly) ? (parsed.hourly as WeatherCardData['hourly']) : undefined,
  };
}

function normalizeStock(parsed: Record<string, unknown>): StockCardData | null {
  if (
    typeof parsed.symbol !== 'string' ||
    typeof parsed.name !== 'string' ||
    typeof parsed.price !== 'number' ||
    typeof parsed.change !== 'number' ||
    typeof parsed.changePercent !== 'number' ||
    typeof parsed.currency !== 'string'
  ) {
    return null;
  }
  return {
    symbol: parsed.symbol,
    name: parsed.name,
    price: parsed.price,
    change: parsed.change,
    changePercent: parsed.changePercent,
    currency: parsed.currency,
    chartPoints: Array.isArray(parsed.chartPoints)
      ? (parsed.chartPoints as Array<{ timestamp: number; price: number }>)
      : undefined,
  };
}

/**
 * Parses a tool's raw JSON string result and, for a mapped tool, returns
 * either its normalized component data (on `{success:true, ...}`) or an
 * error message (on `{success:false, error}` or a shape that doesn't match
 * what the tool is supposed to return). Returns null for unmapped tools or
 * unparseable output - the caller treats that as "nothing to stream".
 *
 * Enhanced with defensive parsing: if the tool result has a success=false,
 * or the data doesn't validate, we return a safe error response instead of
 * letting malformed data reach the UI.
 */
export function normalizeToolResultForUi(
  toolName: string,
  rawResult: string
): { componentType: UIComponentType; data: unknown } | { componentType: UIComponentType; error: string } | null {
  const componentType = TOOL_UI_COMPONENT_MAP[toolName];
  if (!componentType) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawResult);
  } catch {
    return { componentType, error: 'The tool returned a response that could not be read.' };
  }

  // Detect explicit error responses from the tool
  if (parsed.success === false) {
    return { componentType, error: typeof parsed.error === 'string' ? parsed.error : 'The tool call failed.' };
  }

  // Normalize and validate the data based on the tool type
  let data: unknown = null;

  if (toolName === 'get_weather') {
    data = normalizeWeather(parsed);
    // Defensive: validate the result matches expected type
    if (data && !isWeatherCardData(data)) {
      return { componentType, error: 'The weather data could not be validated.' };
    }
  } else if (toolName === 'get_stock_quote') {
    data = normalizeStock(parsed);
    // Defensive: validate the result matches expected type
    if (data && !isStockCardData(data)) {
      return { componentType, error: 'The stock data could not be validated.' };
    }
  }

  if (!data) return { componentType, error: 'The tool returned data in an unexpected shape.' };

  return { componentType, data };
}
