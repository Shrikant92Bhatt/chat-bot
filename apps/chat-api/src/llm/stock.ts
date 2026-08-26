export interface StockQuoteResult {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  chartPoints?: Array<{ timestamp: number; price: number }>;
}

/**
 * Real, structured stock quote via Yahoo Finance's unofficial chart
 * endpoint (no API key, no signup - but also undocumented and unsupported,
 * so it can change or start blocking requests without notice; a User-Agent
 * header is set because Yahoo's edge rejects requests that look like a
 * bare server-side fetch). Fetches both current price and intraday sparkline.
 * Returns a shape that maps directly onto the STOCK_CARD component.
 */
export async function getStockQuote(symbol: string): Promise<StockQuoteResult> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NexusAI-ChatBot/1.0)',
    },
  });
  if (!res.ok) {
    throw new Error(`Stock quote request failed: ${res.status}`);
  }

  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') {
    throw new Error(`Could not find a quote for symbol "${symbol}".`);
  }

  const price = meta.regularMarketPrice;
  const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? price;
  const change = price - previousClose;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;

  // Extract intraday price points for sparkline chart
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const chartPoints = timestamps
    .slice(-30) // Last 30 points for the sparkline
    .map((ts: number, i: number) => ({
      timestamp: ts,
      price: closes[timestamps.length - 30 + i] ?? 0,
    }))
    .filter((p: { timestamp: number; price: number }) => p.price > 0);

  return {
    symbol: meta.symbol ?? symbol.toUpperCase(),
    name: meta.longName || meta.shortName || meta.symbol || symbol.toUpperCase(),
    price,
    change,
    changePercent,
    currency: meta.currency ?? 'USD',
    chartPoints: chartPoints.length > 0 ? chartPoints : undefined,
  };
}
