import { z } from 'zod';
import { providerFetch } from '../http';

/**
 * Market-data source behind the market_data and paper_broker connectors.
 *
 * The only implementation today is Yahoo Finance's public chart endpoint -
 * the same one llm/stock.ts already uses. It is UNOFFICIAL and UNLICENSED:
 * fine for personal experimentation, not for redistribution or anything
 * presented as authoritative. Plan §15 #6 leaves the licensed source (Indian
 * exchange coverage, ETF holdings freshness, cost) as an open decision, so
 * every result carries provenance naming the source, and the tools are kept
 * off the public MCP surface until MARKET_DATA_LICENSED=true says a licensed
 * source has been wired in here.
 */

export const symbolSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9.^=&-]{1,24}$/, 'Invalid ticker symbol')
  .transform((s) => s.toUpperCase());

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  currency: string;
  exchange?: string;
  marketTime?: string;
}

export interface Candle {
  time: string;
  close: number;
  volume?: number;
}

export const SOURCE_NAME = 'Yahoo Finance (unofficial, unlicensed)';

interface ChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string;
        longName?: string;
        shortName?: string;
        regularMarketPrice?: number;
        previousClose?: number;
        chartPreviousClose?: number;
        currency?: string;
        exchangeName?: string;
        regularMarketTime?: number;
      };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }> };
    }>;
    error?: { description?: string } | null;
  };
}

async function chart(symbol: string, range: string, interval: string, signal: AbortSignal) {
  const res = await providerFetch<ChartResponse>({
    baseUrl: 'https://query1.finance.yahoo.com',
    path: `/v8/finance/chart/${encodeURIComponent(symbol)}`,
    query: { range, interval },
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NexusAI-Connector/1.0)' },
    signal,
  });
  const result = res.chart?.result?.[0];
  if (!result?.meta || typeof result.meta.regularMarketPrice !== 'number') {
    throw new Error(`No market data found for "${symbol}".`);
  }
  return result;
}

export async function fetchQuote(symbol: string, signal: AbortSignal): Promise<Quote> {
  const r = await chart(symbol, '5d', '1d', signal);
  const meta = r.meta!;
  const price = meta.regularMarketPrice!;
  const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? price;
  const change = price - previousClose;
  return {
    symbol: meta.symbol ?? symbol,
    name: meta.longName || meta.shortName || meta.symbol || symbol,
    price,
    previousClose,
    change,
    changePercent: previousClose ? (change / previousClose) * 100 : 0,
    currency: (meta.currency ?? 'USD').toUpperCase(),
    exchange: meta.exchangeName,
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : undefined,
  };
}

export async function fetchHistory(
  symbol: string,
  range: string,
  interval: string,
  signal: AbortSignal
): Promise<{ currency: string; name: string; candles: Candle[] }> {
  const r = await chart(symbol, range, interval, signal);
  const ts = r.timestamp ?? [];
  const closes = r.indicators?.quote?.[0]?.close ?? [];
  const volumes = r.indicators?.quote?.[0]?.volume ?? [];
  const candles: Candle[] = [];
  ts.forEach((t, i) => {
    const close = closes[i];
    // Missing closes are dropped, never interpolated - no fabricated data points.
    if (typeof close === 'number' && Number.isFinite(close)) {
      candles.push({ time: new Date(t * 1000).toISOString().slice(0, 10), close, volume: volumes[i] ?? undefined });
    }
  });
  return {
    currency: (r.meta?.currency ?? 'USD').toUpperCase(),
    name: r.meta?.longName || r.meta?.shortName || symbol,
    candles,
  };
}

export const yahooQuoteUrl = (symbol: string) => `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
