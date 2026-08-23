# MCP & Tool Calling Systems Skill

## 1. Tool Call Architecture
- **Adapter**: `McpAdapter` ([`apps/chat-api/src/mcp/adapter.ts`](file:///c:/Users/bhatt/Desktop/Work/AI/chat-bot/apps/chat-api/src/mcp/adapter.ts))
- **Registry**: `MCP_TOOLS` ([`apps/chat-api/src/mcp/tools.ts`](file:///c:/Users/bhatt/Desktop/Work/AI/chat-bot/apps/chat-api/src/mcp/tools.ts))

## 2. Implemented Tools
1. **`system_calculator`**: Safe arithmetic evaluator (no dynamic `eval()`).
2. **`web_search`**: Google Search API fallback with grounded citations (`apps/chat-api/src/llm/web-search.ts`).
3. **`code_interpreter`**: `isolated-vm` sandboxed TypeScript/JavaScript code execution (`apps/chat-api/src/tools/code-sandbox.ts`).
4. **`generate_image`**: Imagen/OpenRouter image generation utility (`apps/chat-api/src/llm/image-gen.ts`).

## 3. UI Schema & Block Streaming
- Dynamic UI card stream rendering (`weather`, `stock`, `calculator`, `code_interpreter`) using standardized UI schemas ([`apps/chat-api/src/orchestration/ui-schema.ts`](file:///c:/Users/bhatt/Desktop/Work/AI/chat-bot/apps/chat-api/src/orchestration/ui-schema.ts)).
