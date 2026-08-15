import { ChatStreamRequest } from '@chat-monorepo/shared';
import { Response } from 'express';
import { GeminiService } from './gemini.service';
import { OpenAIService } from './openai.service';
import { McpAdapter } from '../adapters/mcp.adapter';
import { RagAdapter } from '../adapters/rag.adapter';

export class AIRouterService {
  private geminiService: GeminiService;
  private openAIService: OpenAIService;
  private mcpAdapter: McpAdapter;
  private ragAdapter: RagAdapter;

  constructor() {
    this.geminiService = new GeminiService();
    this.openAIService = new OpenAIService();
    this.mcpAdapter = new McpAdapter();
    this.ragAdapter = new RagAdapter();
  }

  async handleChatStream(request: ChatStreamRequest, res: Response): Promise<void> {
    // 1. Future-proof hook: RAG context enrichment
    if (request.ragContext && request.ragContext.length > 0) {
      const enriched = await this.ragAdapter.enrichPrompt(request.messages, request.ragContext);
      request.messages = enriched;
    }

    // 2. Future-proof hook: MCP tool invocation check
    if (request.mcpEnabled) {
      const mcpTools = await this.mcpAdapter.getAvailableTools();
      console.log(`[AIRouterService] MCP enabled. Available tools count: ${mcpTools.length}`);
    }

    // 3. Dynamic multi-LLM Provider selection
    const isGemini = request.model.startsWith('gemini');

    if (isGemini) {
      console.log(`[AIRouterService] Routing request to Google Gemini (${request.model})`);
      await this.geminiService.streamChat(request, res);
    } else {
      console.log(`[AIRouterService] Routing request to OpenAI (${request.model})`);
      await this.openAIService.streamChat(request, res);
    }
  }
}
