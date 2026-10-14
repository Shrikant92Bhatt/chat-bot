import { z } from 'zod';
import { ConnectorAdapter, ToolDefinition, ToolRunContext } from '../../connector.types';
import { ConnectorConfig } from '../../connector-config';
import { COLLECTIONS } from '../../connector-store';
import { SOURCE_NAME, fetchQuote, symbolSchema } from '../market-data/market-data.source';
import { concentrationIndex } from '../market-data/indicators';

/**
 * Paper-trading broker (plan §8 Phase D: "read-only, followed by paper
 * trading"). Everything is simulated against NexusAI's own store - no broker
 * API is called and no real money moves. Live trading is NOT implemented
 * anywhere: tier 4 is denied by permission-policy.ts regardless of flags, and
 * a real broker adapter is a separately reviewed project (plan §15 #7).
 *
 * Even simulated orders go through the full approval flow, so the
 * deterministic risk layer here (symbol validation, quantity/notional caps,
 * currency match, buying power, position checks) and the approval binding are
 * exercised before any real broker ever exists.
 */

export interface PaperPosition {
  quantity: number;
  avgPrice: number;
}

export interface PaperOrder {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  notional: number;
  filledAt: string;
}

export interface PaperPortfolio extends Record<string, unknown> {
  ownerUid: string;
  connectionId: string;
  currency: string;
  cash: number;
  positions: Record<string, PaperPosition>;
  orders: PaperOrder[];
  createdAt: number;
  updatedAt: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function freshPortfolio(ctx: ToolRunContext): PaperPortfolio {
  const t = Date.now();
  return {
    ownerUid: ctx.uid,
    connectionId: ctx.connectionId,
    currency: ConnectorConfig.paperBroker.baseCurrency(),
    cash: ConnectorConfig.paperBroker.startingCash(),
    positions: {},
    orders: [],
    createdAt: t,
    updatedAt: t,
  };
}

async function loadPortfolio(ctx: ToolRunContext): Promise<PaperPortfolio> {
  const existing = await ctx.store.get<PaperPortfolio>(COLLECTIONS.paperPortfolios, ctx.connectionId);
  if (existing && existing.ownerUid !== ctx.uid) throw new Error('Portfolio not found.');
  return existing ?? freshPortfolio(ctx);
}

/** Pure order validation + fill. Throws a user-safe Error on any risk-check failure. */
export function applyPaperOrder(
  portfolio: PaperPortfolio,
  order: { id: string; symbol: string; side: 'buy' | 'sell'; quantity: number },
  quote: { price: number; currency: string },
  limits: { maxQuantity: number; maxNotional: number }
): PaperPortfolio {
  if (!Number.isInteger(order.quantity) || order.quantity <= 0) throw new Error('Quantity must be a positive whole number.');
  if (order.quantity > limits.maxQuantity) throw new Error(`Quantity exceeds the ${limits.maxQuantity}-share limit.`);
  if (!(quote.price > 0)) throw new Error('No valid price available for this symbol.');
  if (quote.currency !== portfolio.currency) {
    throw new Error(`This paper account trades in ${portfolio.currency}; ${order.symbol} is quoted in ${quote.currency}.`);
  }
  const notional = round2(quote.price * order.quantity);
  if (notional > limits.maxNotional) throw new Error(`Order value ${notional} exceeds the ${limits.maxNotional} per-order limit.`);

  const positions = { ...portfolio.positions };
  const current = positions[order.symbol] ?? { quantity: 0, avgPrice: 0 };
  let cash = portfolio.cash;

  if (order.side === 'buy') {
    if (notional > cash) throw new Error(`Insufficient paper buying power: need ${notional}, have ${round2(cash)}.`);
    const quantity = current.quantity + order.quantity;
    positions[order.symbol] = { quantity, avgPrice: round2((current.avgPrice * current.quantity + notional) / quantity) };
    cash -= notional;
  } else {
    if (current.quantity < order.quantity) throw new Error(`Cannot sell ${order.quantity}; position is ${current.quantity}.`);
    const quantity = current.quantity - order.quantity;
    if (quantity === 0) delete positions[order.symbol];
    else positions[order.symbol] = { quantity, avgPrice: current.avgPrice };
    cash += notional;
  }

  const filled: PaperOrder = { ...order, price: quote.price, notional, filledAt: new Date().toISOString() };
  return { ...portfolio, cash: round2(cash), positions, orders: [filled, ...portfolio.orders].slice(0, 100), updatedAt: Date.now() };
}

const getPortfolio: ToolDefinition = {
  name: 'paper_get_portfolio',
  version: '1',
  title: 'Get paper portfolio',
  description:
    'Shows the user\'s SIMULATED paper-trading portfolio: cash, positions marked to the latest price, exposure ' +
    'weights, concentration and recent simulated orders. No real money is involved.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    currency: z.string(),
    cash: z.number(),
    marketValue: z.number(),
    totalValue: z.number(),
    concentrationIndex: z.number(),
    positions: z.array(
      z.object({
        symbol: z.string(),
        quantity: z.number(),
        avgPrice: z.number(),
        lastPrice: z.number().nullable(),
        marketValue: z.number().nullable(),
        unrealizedPnl: z.number().nullable(),
        weightPct: z.number().nullable(),
      })
    ),
    recentOrders: z.array(z.object({ symbol: z.string(), side: z.string(), quantity: z.number(), price: z.number(), filledAt: z.string() })),
    simulated: z.literal(true),
  }),
  riskTier: 0,
  capability: 'read',
  requiredScopes: [],
  requiresApproval: false,
  timeoutMs: 15_000,
  maxAttempts: 1,
  idempotent: true,
  cacheTtlMs: 0,
  async run(ctx) {
    const p = await loadPortfolio(ctx);
    const entries = Object.entries(p.positions);
    const prices = await Promise.all(
      entries.map(([symbol]) => fetchQuote(symbol, ctx.signal).then((q) => q.price).catch(() => null))
    );
    const rows = entries.map(([symbol, pos], i) => {
      const lastPrice = prices[i];
      const marketValue = lastPrice === null ? null : round2(lastPrice * pos.quantity);
      return {
        symbol,
        quantity: pos.quantity,
        avgPrice: pos.avgPrice,
        lastPrice,
        marketValue,
        unrealizedPnl: marketValue === null ? null : round2(marketValue - pos.avgPrice * pos.quantity),
        weightPct: null as number | null,
      };
    });
    const marketValue = round2(rows.reduce((a, r) => a + (r.marketValue ?? 0), 0));
    const totalValue = round2(p.cash + marketValue);
    for (const r of rows) r.weightPct = r.marketValue === null || totalValue === 0 ? null : round2((r.marketValue / totalValue) * 100);
    const data = {
      currency: p.currency,
      cash: p.cash,
      marketValue,
      totalValue,
      concentrationIndex: concentrationIndex(rows.map((r) => (r.weightPct ?? 0) / 100)),
      positions: rows,
      recentOrders: p.orders.slice(0, 10).map((o) => ({ symbol: o.symbol, side: o.side, quantity: o.quantity, price: o.price, filledAt: o.filledAt })),
      simulated: true as const,
    };
    return {
      data,
      display: {
        title: 'Paper portfolio (simulated)',
        summary: `Total ${totalValue} ${p.currency} · cash ${p.cash}`,
        emptyMessage: 'No positions yet.',
        table: {
          columns: ['Symbol', 'Qty', 'Avg', 'Last', 'Value', 'P&L', 'Weight %'],
          rows: rows.map((r) => [r.symbol, r.quantity, r.avgPrice, r.lastPrice, r.marketValue, r.unrealizedPnl, r.weightPct]),
        },
      },
      sources: [{ title: `Prices: ${SOURCE_NAME}`, retrievedAt: new Date().toISOString() }],
    };
  },
};

const placeOrderInput = z.object({
  symbol: symbolSchema,
  side: z.enum(['buy', 'sell']),
  quantity: z.number().int().positive(),
});

const placeOrder: ToolDefinition<z.infer<typeof placeOrderInput>> = {
  name: 'paper_place_order',
  version: '1',
  title: 'Place a paper (simulated) order',
  description:
    'Proposes a SIMULATED market order in the paper-trading account. No real money or broker is involved. It does ' +
    'NOT run immediately: the user must approve the exact symbol, side and quantity; it then fills at the latest price.',
  inputSchema: placeOrderInput,
  outputSchema: z.object({
    orderId: z.string(),
    symbol: z.string(),
    side: z.string(),
    quantity: z.number(),
    price: z.number(),
    notional: z.number(),
    cashAfter: z.number(),
    simulated: z.literal(true),
  }),
  riskTier: 2,
  capability: 'write',
  requiredScopes: [],
  requiresApproval: true,
  timeoutMs: 15_000,
  maxAttempts: 1,
  idempotent: false,
  cacheTtlMs: 0,
  describeApproval: (input) => ({
    summary: `SIMULATED ${input.side.toUpperCase()} ${input.quantity} × ${input.symbol} (paper account, no real money)`,
    target: `Paper account · ${input.symbol}`,
    details: [
      { label: 'Account', value: 'Paper trading (simulated)' },
      { label: 'Symbol', value: input.symbol },
      { label: 'Side', value: input.side },
      { label: 'Quantity', value: String(input.quantity) },
      { label: 'Order type', value: 'Market (fills at latest price at approval time)' },
    ],
  }),
  async run(ctx, input) {
    const orderId = ctx.idempotencyKey ?? `paper-${Date.now()}`;
    const quote = await fetchQuote(input.symbol, ctx.signal);
    const limits = {
      maxQuantity: ConnectorConfig.paperBroker.maxOrderQuantity(),
      maxNotional: ConnectorConfig.paperBroker.maxOrderNotional(),
    };
    const template = freshPortfolio(ctx);
    const outcome = await ctx.store.transact<PaperPortfolio, { order: PaperOrder; cash: number } | { error: string }>(
      COLLECTIONS.paperPortfolios,
      ctx.connectionId,
      (current) => {
        if (current && current.ownerUid !== ctx.uid) return { next: undefined, result: { error: 'Portfolio not found.' } };
        const portfolio = current ?? template;
        // Idempotency: an order id that already filled returns the original fill.
        const existing = portfolio.orders.find((o) => o.id === orderId);
        if (existing) return { next: undefined, result: { order: existing, cash: portfolio.cash } };
        try {
          const next = applyPaperOrder(portfolio, { id: orderId, ...input }, quote, limits);
          return { next, result: { order: next.orders[0], cash: next.cash } };
        } catch (error) {
          return { next: undefined, result: { error: (error as Error).message } };
        }
      }
    );
    if ('error' in outcome) throw new Error(outcome.error);
    const o = outcome.order;
    return {
      data: { orderId: o.id, symbol: o.symbol, side: o.side, quantity: o.quantity, price: o.price, notional: o.notional, cashAfter: outcome.cash, simulated: true as const },
      display: {
        title: `Simulated ${o.side} filled`,
        items: [{ title: `${o.side.toUpperCase()} ${o.quantity} × ${o.symbol} @ ${o.price}`, badge: 'paper', meta: [{ label: 'Cash after', value: String(outcome.cash) }] }],
      },
      sources: [{ title: `Fill price: ${SOURCE_NAME}`, retrievedAt: new Date().toISOString() }],
    };
  },
};

export const paperBrokerConnector: ConnectorAdapter = {
  id: 'paper_broker',
  name: 'Paper trading',
  description: 'A simulated brokerage account for practicing - no real money, no real broker. Every order needs your approval.',
  defaultCapabilities: ['read'],
  unavailableReason: () => (ConnectorConfig.marketData.provider() === 'none' ? 'Paper trading needs market data, which is disabled.' : null),
  oauth: null,
  tools: [getPortfolio, placeOrder],
};
