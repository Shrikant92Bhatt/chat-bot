# Orchestration & Subsystem Emulator Skill

## Subsystems Overview
1. **Orchestration**: LangGraph state machine node sequence execution (`apps/chat-api/src/orchestration/graph.ts`).
2. **Embedding**: Direct vector embeddings for similarity calculations (`apps/chat-api/src/adapters/vector-db.adapter.ts`).
3. **RAG & Hybrid Reranking**: Dense similarity retrieval combined with BM25 keyword scoring (`apps/chat-api/src/rag/reranker.ts`).
4. **Memory Extraction**: Regex-gated long-term memory persistence (`apps/chat-api/src/memory/extractor.ts`).
5. **Context Builder**: Structured system prompt assembly using templates (`apps/chat-api/src/context/context-builder.ts`).
6. **Web Search**: Dynamic Google Search API integration (`apps/chat-api/src/llm/web-search.ts`).
7. **MCP Tools**: Sandboxed execution and external tools (`apps/chat-api/src/mcp/tools.ts`).
8. **LLM Stream**: SSE token generation and telemetry streaming (`apps/chat-api/src/llm/client.ts`).

## Admin Emulator Architecture
- API Endpoint: `POST /api/v1/admin/emulator/stream`
- Frontend Library: `@chat-monorepo/admin-emulator` (`libs/frontend/admin-emulator`)
- Access Control: Strict server-side verification via `authenticateToken` + `requireAdmin`.
