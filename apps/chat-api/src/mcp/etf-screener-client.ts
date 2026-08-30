import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import type { DynamicStructuredTool } from '@langchain/core/tools';

const CONNECT_TIMEOUT_MS = 10_000;

/** Races a promise against a timeout, so a slow/unreachable MCP server can't stall a turn. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms.`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let cachedTools: DynamicStructuredTool[] | null = null;
let inFlight: Promise<DynamicStructuredTool[]> | null = null;

/**
 * Lazily connects to the ETF_Screener repo's MCP server (app/api/mcp there)
 * over Streamable HTTP and returns its tools as LangChain StructuredTools,
 * ready to merge into McpAdapter.getTools(). The connection is made once per
 * process and its result (including an empty array on failure) is cached -
 * this integration is additive, never a hard dependency for the chat agent
 * to function, so an unset ETF_SCREENER_MCP_URL, an unreachable server, or a
 * slow handshake all resolve to an empty tool list rather than throwing.
 */
export async function getEtfScreenerTools(): Promise<DynamicStructuredTool[]> {
  if (cachedTools) return cachedTools;
  if (inFlight) return inFlight;

  const url = process.env.ETF_SCREENER_MCP_URL;
  if (!url) return [];

  inFlight = (async () => {
    try {
      const client = new MultiServerMCPClient({
        etfScreener: {
          transport: 'http',
          url,
          headers: process.env.ETF_SCREENER_MCP_SECRET
            ? { Authorization: `Bearer ${process.env.ETF_SCREENER_MCP_SECRET}` }
            : undefined,
        },
      });
      const tools = await withTimeout(client.getTools(), CONNECT_TIMEOUT_MS, 'ETF Screener MCP connect');
      cachedTools = tools;
      return tools;
    } catch (error) {
      console.error('[mcp/etf-screener-client] Failed to connect to ETF Screener MCP server:', error);
      cachedTools = [];
      return [];
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
