import { MCP_TOOLS } from './tools';

/**
 * MCP (Model Context Protocol) Adapter.
 * Thin wrapper around the LangChain tool registry so the orchestration
 * graph can bind tools to the model and execute whichever ones it calls.
 */
export class McpAdapter {
  getTools() {
    return MCP_TOOLS;
  }

  getAvailableTools() {
    return MCP_TOOLS.map((t) => ({ name: t.name, description: t.description }));
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    const tool = MCP_TOOLS.find((t) => t.name === toolName);
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
