import { tool } from '@langchain/core/tools';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { ConnectorConfig } from './connector-config';
import { getConnectorPlatform } from './connector-platform';
import { toModelContent } from './tool-executor';

/**
 * Exposes the signed-in user's usable connector tools to the LangGraph agent
 * as ordinary LangChain tools. Each one is a thin closure over the shared
 * ToolExecutor with the uid fixed server-side from the verified session - the
 * model never supplies (and can't change) whose account a call runs against.
 *
 * Built per user and cached briefly, since the agent<->tools loop asks for
 * the tool list on every pass of a turn.
 */

const TTL_MS = 15_000;
const cache = new Map<string, { tools: StructuredToolInterface[]; expiresAt: number }>();

export async function getConnectorToolsForUser(uid: string | null | undefined): Promise<StructuredToolInterface[]> {
  if (!uid || !ConnectorConfig.enabled()) return [];
  const hit = cache.get(uid);
  if (hit && hit.expiresAt > Date.now()) return hit.tools;

  try {
    const platform = getConnectorPlatform();
    const usable = await platform.executor.listUsableTools({ uid, client: 'nexus' });
    const tools = usable.map(({ tool: def }) =>
      tool(
        async (args: unknown) => toModelContent(await platform.executor.execute({ uid, client: 'nexus' }, def.name, args)),
        { name: def.name, description: def.description, schema: def.inputSchema as never }
      ) as unknown as StructuredToolInterface
    );
    cache.set(uid, { tools, expiresAt: Date.now() + TTL_MS });
    if (cache.size > 1000) cache.delete(cache.keys().next().value as string);
    return tools;
  } catch (error) {
    // Fail soft: a connector outage must never break the chat turn itself.
    console.error('[connectors/langchain-tools] Failed to list connector tools:', (error as Error).message);
    return [];
  }
}

/** Drop a user's cached tool list (after connect/disconnect/capability changes in this instance). */
export function invalidateConnectorTools(uid: string): void {
  cache.delete(uid);
}
