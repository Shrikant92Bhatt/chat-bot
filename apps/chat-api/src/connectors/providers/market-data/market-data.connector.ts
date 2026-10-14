import { z } from 'zod';
import { ConnectorAdapter, ToolDefinition } from '../../connector.types';
import { ConnectorConfig } from '../../connector-config';
import { SOURCE_NAME, fetchHistory, fetchQuote, symbolSchema, yahooQuoteUrl } from './market-data.source';
import { annualizedVolatility, ema, periodReturn, rsi, sma } from './indicators';

/**
 * Read-only market data (plan §8 Phase D). Kept separate from any broker
 * adapter: nothing here can place, amend or cancel an order. Results always
 * name their source and retrieval time, and are informational - never
 * investment advice.
 */

const now = () => new Date().toISOString();
const source = (symbol: string) => ({ title: `${SOURCE_NAME}: ${symbol}`, url: yahooQuoteUrl(symbol), retrievedAt: now() });

const rangeSchema = z.enum(['1mo', '3mo', '6mo', '1y', '2y', '5y']).default('6mo');
const intervalSchema = z.enum(['1d', '1wk']).default('1d');

const getQuote: ToolDefinition = {
  name: 'market_get_quote',
  version: '1',
  title: 'Get a market quote',
  description:
    'Gets the latest price, previous close and change for a stock/ETF/index symbol (e.g. "AAPL", "NIFTYBEES.NS", ' +
    '"^NSEI"). Informational data with its source named; not investment advice.',
  inputSchema: z.object({ symbol: symbolSchema }),
  outputSchema: z.object({
    symbol: z.string(),
    name: z.string(),
    price: z.number(),
    previousClose: z.number(),
    change: z.number(),
    changePercent: z.number(),
    currency: z.string(),
    exchange: z.string().optional(),
    marketTime: z.string().optional(),
    source: z.string(),
  }),
  riskTier: 1,
  capability: 'read',
  requiredScopes: [],
  requiresApproval: false,
  timeoutMs: 8_000,
  maxAttempts: 2,
  idempotent: true,
  cacheTtlMs: 15_000,
  get mcpExposed() {
    return ConnectorConfig.marketData.licensed();
  },
  async run(ctx, input) {
    const q = await fetchQuote(input.symbol, ctx.signal);
    const fmt = (n: number) => n.toFixed(2);
    return {
      data: { ...q, source: SOURCE_NAME },
      display: {
        title: `${q.name} (${q.symbol})`,
        summary: `${fmt(q.price)} ${q.currency} · ${q.change >= 0 ? '+' : ''}${fmt(q.change)} (${fmt(q.changePercent)}%)`,
        items: [
          {
            title: q.symbol,
            badge: q.change >= 0 ? 'up' : 'down',
            meta: [
              { label: 'Price', value: `${fmt(q.price)} ${q.currency}` },
              { label: 'Prev close', value: fmt(q.previousClose) },
              ...(q.exchange ? [{ label: 'Exchange', value: q.exchange }] : []),
              ...(q.marketTime ? [{ label: 'As of', value: q.marketTime }] : []),
            ],
          },
        ],
      },
      sources: [source(q.symbol)],
    };
  },
};

const getHistory: ToolDefinition = {
  name: 'market_get_price_history',
  version: '1',
  title: 'Get price history',
  description: 'Gets daily or weekly closing prices for a symbol over a range (1mo..5y). Missing days are omitted, never filled in.',
  inputSchema: z.object({ symbol: symbolSchema, range: rangeSchema, interval: intervalSchema }),
  outputSchema: z.object({
    symbol: z.string(),
    name: z.string(),
    currency: z.string(),
    candles: z.array(z.object({ time: z.string(), close: z.number(), volume: z.number().optional() })),
    source: z.string(),
  }),
  riskTier: 1,
  capability: 'read',
  requiredScopes: [],
  requiresApproval: false,
  timeoutMs: 10_000,
  maxAttempts: 2,
  idempotent: true,
  cacheTtlMs: 5 * 60_000,
  async run(ctx, input) {
    const h = await fetchHistory(input.symbol, input.range, input.interval, ctx.signal);
    // Keep the most recent 260 points at most - plenty for a chart, bounded for the model.
    const candles = h.candles.slice(-260);
    return {
      data: { symbol: input.symbol, name: h.name, currency: h.currency, candles, source: SOURCE_NAME },
      display: {
        title: `${h.name} (${input.symbol}) · ${input.range}`,
        summary: candles.length ? `${candles.length} points, last close ${candles[candles.length - 1].close.toFixed(2)} ${h.currency}` : undefined,
        emptyMessage: 'No price history available.',
        table: { columns: ['Date', 'Close'], rows: candles.slice(-15).map((c) => [c.time, Number(c.close.toFixed(2))]) },
      },
      sources: [source(input.symbol)],
      truncated: h.candles.length > candles.length,
    };
  },
};

const indicators: ToolDefinition = {
  name: 'market_technical_indicators',
  version: '1',
  title: 'Compute technical indicators',
  description:
    'Computes SMA(20/50/200), EMA(20), RSI(14), period return and annualized volatility for a symbol from daily ' +
    'closes, deterministically in code. Use this instead of estimating indicator values.',
  inputSchema: z.object({ symbol: symbolSchema, range: z.enum(['3mo', '6mo', '1y', '2y']).default('1y') }),
  outputSchema: z.object({
    symbol: z.string(),
    currency: z.string(),
    lastClose: z.number().nullable(),
    asOf: z.string().nullable(),
    points: z.number(),
    sma20: z.number().nullable(),
    sma50: z.number().nullable(),
    sma200: z.number().nullable(),
    ema20: z.number().nullable(),
    rsi14: z.number().nullable(),
    periodReturnPct: z.number().nullable(),
    annualizedVolatilityPct: z.number().nullable(),
    source: z.string(),
  }),
  riskTier: 0,
  capability: 'read',
  requiredScopes: [],
  requiresApproval: false,
  timeoutMs: 10_000,
  maxAttempts: 2,
  idempotent: true,
  cacheTtlMs: 5 * 60_000,
  async run(ctx, input) {
    const h = await fetchHistory(input.symbol, input.range, '1d', ctx.signal);
    const closes = h.candles.map((c) => c.close);
    const last = h.candles[h.candles.length - 1];
    const data = {
      symbol: input.symbol,
      currency: h.currency,
      lastClose: last?.close ?? null,
      asOf: last?.time ?? null,
      points: closes.length,
      sma20: sma(closes, 20),
      sma50: sma(closes, 50),
      sma200: sma(closes, 200),
      ema20: ema(closes, 20),
      rsi14: rsi(closes, 14),
      periodReturnPct: periodReturn(closes),
      annualizedVolatilityPct: annualizedVolatility(closes),
      source: SOURCE_NAME,
    };
    const show = (v: number | null) => (v === null ? 'n/a (not enough data)' : String(v));
    return {
      data,
      display: {
        title: `Indicators · ${input.symbol} (${input.range})`,
        summary: data.asOf ? `As of ${data.asOf}, ${data.points} daily closes` : undefined,
        table: {
          columns: ['Indicator', 'Value'],
          rows: [
            ['Last close', show(data.lastClose)],
            ['SMA 20', show(data.sma20)],
            ['SMA 50', show(data.sma50)],
            ['SMA 200', show(data.sma200)],
            ['EMA 20', show(data.ema20)],
            ['RSI 14', show(data.rsi14)],
            ['Return %', show(data.periodReturnPct)],
            ['Volatility % (ann.)', show(data.annualizedVolatilityPct)],
          ],
        },
      },
      sources: [source(input.symbol)],
    };
  },
};

export const marketDataConnector: ConnectorAdapter = {
  id: 'market_data',
  name: 'Market data',
  description: 'Read-only quotes, price history and deterministic technical indicators. Informational only, not advice.',
  defaultCapabilities: ['read'],
  unavailableReason: () => (ConnectorConfig.marketData.provider() === 'none' ? 'Market data is disabled on this server.' : null),
  oauth: null,
  tools: [getQuote, getHistory, indicators],
};
