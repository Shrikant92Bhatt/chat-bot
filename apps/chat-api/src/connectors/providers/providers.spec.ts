import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectorRegistry, DEFAULT_ADAPTERS } from '../connector-registry';
import { MemoryConnectorStore } from '../connector-store';
import { ToolRunContext } from '../connector.types';
import { githubConnector } from './github/github.connector';
import { extractPlainText, gmailConnector } from './google/gmail.connector';
import { annualizedVolatility, concentrationIndex, ema, periodReturn, rsi, sma } from './market-data/indicators';
import { applyPaperOrder, PaperPortfolio } from './brokers/paper-broker.connector';
import { socialConnector } from './social/social.connector';
import { setConnectorTestEnv } from '../testing/fake-connector';

const tool = (adapter: { tools: Array<{ name: string }> }, name: string) =>
  adapter.tools.find((t) => t.name === name) as unknown as import('../connector.types').ToolDefinition;

function ctx(overrides: Partial<ToolRunContext> = {}): ToolRunContext {
  return {
    uid: 'alice',
    connectionId: 'conn-1',
    credentials: { accessToken: 'token-1' },
    store: new MemoryConnectorStore(),
    signal: new AbortController().signal,
    ...overrides,
  };
}

function stubFetch(handler: (url: URL, init?: RequestInit) => unknown) {
  const seen: Array<{ url: URL; init?: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL | string, init?: RequestInit) => {
      const u = new URL(String(url));
      seen.push({ url: u, init });
      return new Response(JSON.stringify(handler(u, init)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    })
  );
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe('registry invariants over the real connectors', () => {
  it('has unique tool names, approval descriptions for every write, and only read tools on MCP', () => {
    setConnectorTestEnv();
    process.env.MARKET_DATA_LICENSED = 'true';
    const registry = new ConnectorRegistry(DEFAULT_ADAPTERS);
    for (const adapter of registry.listAdapters()) {
      for (const t of adapter.tools) {
        if (t.capability === 'write' && t.riskTier >= 2) expect(t.requiresApproval).toBe(true);
        if (t.mcpExposed) expect(t.capability).toBe('read');
        if (t.requiresApproval) expect(t.maxAttempts).toBe(1);
      }
    }
    delete process.env.MARKET_DATA_LICENSED;
  });

  it('reports unconfigured OAuth providers as unavailable instead of failing later', () => {
    setConnectorTestEnv();
    delete process.env.GITHUB_CONNECTOR_CLIENT_ID;
    const registry = new ConnectorRegistry(DEFAULT_ADAPTERS);
    const github = registry.listProviderSummaries().find((p) => p.id === 'github')!;
    expect(github.available).toBe(false);
    expect(github.unavailableReason).toMatch(/not configured/);
  });
});

describe('GitHub connector', () => {
  it('rejects path traversal, bad owners and bad refs before any request', () => {
    const getFile = tool(githubConnector, 'github_get_file');
    expect(getFile.inputSchema.safeParse({ owner: 'a', repo: 'b', path: '../secrets' }).success).toBe(false);
    expect(getFile.inputSchema.safeParse({ owner: 'a', repo: 'b', path: '/etc/passwd' }).success).toBe(false);
    expect(getFile.inputSchema.safeParse({ owner: 'a/b', repo: 'b', path: 'x' }).success).toBe(false);
    expect(getFile.inputSchema.safeParse({ owner: 'a', repo: 'b', path: 'src/x.ts', ref: 'main;rm' }).success).toBe(false);
    expect(getFile.inputSchema.safeParse({ owner: 'Shrikant92Bhatt', repo: 'chat-bot', path: 'src/app.ts' }).success).toBe(true);
  });

  it('scopes issue search to the requested repository and collapses smuggled qualifiers', async () => {
    const seen = stubFetch(() => ({ total_count: 0, items: [] }));
    const search = tool(githubConnector, 'github_search_issues');
    const input = search.inputSchema.parse({ query: 'flaky test\nrepo:other/secret', owner: 'Shrikant92Bhatt', repo: 'chat-bot', type: 'pr' });
    await search.run(ctx(), input);
    const q = seen[0].url.searchParams.get('q')!;
    expect(seen[0].url.origin).toBe('https://api.github.com');
    expect(q).toContain('repo:Shrikant92Bhatt/chat-bot');
    expect(q).toContain('is:pr');
    expect(q).not.toContain('\n');
    expect((seen[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
  });

  it('summarizes failed jobs and steps for the latest failed run', async () => {
    stubFetch((url) => {
      if (url.pathname.endsWith('/actions/runs')) {
        return { workflow_runs: [{ id: 7, name: 'CI', head_branch: 'main', head_sha: 'abc', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/o/r/actions/runs/7', event: 'push', created_at: '2026-01-01T00:00:00Z' }] };
      }
      return {
        jobs: [
          { name: 'lint', conclusion: 'success', steps: [] },
          { name: 'test', html_url: 'https://github.com/o/r/runs/1', conclusion: 'failure', steps: [{ name: 'npm test', conclusion: 'failure' }, { name: 'checkout', conclusion: 'success' }] },
        ],
      };
    });
    const failures = tool(githubConnector, 'github_get_workflow_failures');
    const out = await failures.run(ctx(), failures.inputSchema.parse({ owner: 'o', repo: 'r' }));
    expect(failures.outputSchema.safeParse(out.data).success).toBe(true);
    expect(out.data).toMatchObject({ run: { id: 7, conclusion: 'failure' }, failedJobs: [{ name: 'test', failedSteps: ['npm test'] }] });
  });

  it('describes writes exactly for the approval card', () => {
    const createIssue = tool(githubConnector, 'github_create_issue');
    const input = createIssue.inputSchema.parse({ owner: 'o', repo: 'r', title: 'Bug', body: 'Steps…' });
    expect(createIssue.describeApproval!(input)).toMatchObject({
      target: 'o/r',
      details: expect.arrayContaining([{ label: 'Title', value: 'Bug' }, { label: 'Body', value: 'Steps…' }]),
    });
  });
});

describe('Gmail connector', () => {
  it('rejects header injection in subject and malformed recipients', () => {
    const send = tool(gmailConnector, 'gmail_send_message');
    expect(send.inputSchema.safeParse({ to: ['a@b.co'], subject: 'Hi\r\nBcc: evil@x.co', body: 'x' }).success).toBe(false);
    expect(send.inputSchema.safeParse({ to: ['not-an-email'], subject: 'Hi', body: 'x' }).success).toBe(false);
    expect(send.inputSchema.safeParse({ to: ['a@b.co'], subject: 'Hi', body: 'x' }).success).toBe(true);
    expect(send.riskTier).toBe(3);
    expect(send.requiresApproval).toBe(true);
  });

  it('extracts plain text and strips HTML/script from bodies', () => {
    const b64 = (s: string) => Buffer.from(s).toString('base64url');
    expect(extractPlainText({ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('Hello there') } }] })).toBe('Hello there');
    expect(extractPlainText({ mimeType: 'text/html', body: { data: b64('<p>Hi<script>alert(1)</script> <b>you</b></p>') } })).toBe('Hi you');
  });

  it('sends a correctly encoded RFC 2822 message', async () => {
    const seen = stubFetch(() => ({ id: 'm1', threadId: 't1' }));
    const send = tool(gmailConnector, 'gmail_send_message');
    await send.run(ctx(), send.inputSchema.parse({ to: ['a@b.co'], subject: 'Héllo', body: 'Body text' }));
    const raw = JSON.parse(String(seen[0].init?.body)).raw as string;
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    expect(decoded).toContain('To: a@b.co');
    expect(decoded).toContain('Subject: =?UTF-8?B?');
    expect(decoded.endsWith('Body text')).toBe(true);
  });
});

describe('market indicators (deterministic)', () => {
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0, 46.03, 46.41, 46.22, 45.64];

  it('computes SMA/EMA/RSI and returns null when there is not enough data', () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(sma([1], 2)).toBeNull();
    expect(ema([1, 2, 3, 4, 5], 3)).toBe(4);
    // Classic Wilder example series: RSI(14) ≈ 70 at the 15th close.
    expect(rsi(closes.slice(0, 15), 14)).toBeCloseTo(70.46, 0);
    expect(rsi([1, 2], 14)).toBeNull();
    expect(periodReturn([100, 110])).toBe(10);
    expect(annualizedVolatility([100, 100, 100])).toBe(0);
    expect(concentrationIndex([0.5, 0.5])).toBe(0.5);
  });
});

describe('paper broker risk checks', () => {
  const base = (): PaperPortfolio => ({ ownerUid: 'a', connectionId: 'c', currency: 'INR', cash: 10_000, positions: {}, orders: [], createdAt: 0, updatedAt: 0 });
  const limits = { maxQuantity: 100, maxNotional: 5_000 };

  it('fills a buy and a sell, tracking cash and average price', () => {
    const afterBuy = applyPaperOrder(base(), { id: '1', symbol: 'TCS.NS', side: 'buy', quantity: 10 }, { price: 100, currency: 'INR' }, limits);
    expect(afterBuy.cash).toBe(9_000);
    expect(afterBuy.positions['TCS.NS']).toEqual({ quantity: 10, avgPrice: 100 });
    const afterSell = applyPaperOrder(afterBuy, { id: '2', symbol: 'TCS.NS', side: 'sell', quantity: 10 }, { price: 120, currency: 'INR' }, limits);
    expect(afterSell.cash).toBe(10_200);
    expect(afterSell.positions['TCS.NS']).toBeUndefined();
  });

  it('rejects oversize, over-notional, wrong-currency, short and unfunded orders', () => {
    const q = { price: 100, currency: 'INR' };
    expect(() => applyPaperOrder(base(), { id: '1', symbol: 'X', side: 'buy', quantity: 101 }, q, limits)).toThrow(/limit/);
    expect(() => applyPaperOrder(base(), { id: '1', symbol: 'X', side: 'buy', quantity: 60 }, q, limits)).toThrow(/per-order limit/);
    expect(() => applyPaperOrder(base(), { id: '1', symbol: 'AAPL', side: 'buy', quantity: 1 }, { price: 1, currency: 'USD' }, limits)).toThrow(/INR/);
    expect(() => applyPaperOrder(base(), { id: '1', symbol: 'X', side: 'sell', quantity: 1 }, q, limits)).toThrow(/Cannot sell/);
    expect(() =>
      applyPaperOrder({ ...base(), cash: 50 }, { id: '1', symbol: 'X', side: 'buy', quantity: 1 }, q, limits)
    ).toThrow(/buying power/);
  });
});

describe('social drafts', () => {
  beforeEach(() => setConnectorTestEnv());

  it('enforces network length limits and never publishes', async () => {
    const create = tool(socialConnector, 'social_create_post_draft');
    expect(create.inputSchema.safeParse({ network: 'x', text: 'a'.repeat(281) }).success).toBe(false);
    const store = new MemoryConnectorStore();
    const out = await create.run(ctx({ store }), create.inputSchema.parse({ network: 'x', text: 'Shipping connectors today', hashtags: ['ai'] }));
    expect(out.data.draft).toMatchObject({ network: 'x', hashtags: ['#ai'], limit: 280 });
    expect(out.display?.title).toMatch(/not published/);

    const list = tool(socialConnector, 'social_list_drafts');
    const other = await list.run(ctx({ store, uid: 'bob' }), {});
    expect(other.data.drafts).toEqual([]);
  });
});
