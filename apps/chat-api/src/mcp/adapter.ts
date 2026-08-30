import { MCP_TOOLS } from './tools';
import { getEtfScreenerTools } from './etf-screener-client';

/**
 * MCP (Model Context Protocol) Adapter.
 * Thin wrapper around the LangChain tool registry so the orchestration
 * graph can bind tools to the model and execute whichever ones it calls.
 * Merges the local tool registry with tools discovered from the real MCP
 * server exposed by the ETF_Screener repo (see mcp/etf-screener-client.ts) -
 * connecting to that server is best-effort, so it never blocks or breaks
 * the local tools if unreachable.
 */
export class McpAdapter {
  async getTools() {
    const remoteTools = await getEtfScreenerTools();
    return [...MCP_TOOLS, ...remoteTools];
  }

  async getAvailableTools() {
    const tools = await this.getTools();
    return tools.map((t) => ({ name: t.name, description: t.description }));
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    const tools = await this.getTools();
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      return JSON.stringify({ success: false, error: `Tool ${toolName} not found in registry.` });
    }

    try {
      return await (tool.invoke as (input: Record<string, unknown>) => Promise<string>)(args);
    } catch (error) {
      console.error(`[McpAdapter] Tool execution failed for ${toolName}:`, error);
      return JSON.stringify({ success: false, error: (error as Error).message });
    }
  }
}
