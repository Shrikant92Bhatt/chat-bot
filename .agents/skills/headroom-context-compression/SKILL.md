# Headroom Context Compression Skill

## Purpose & Overview
Headroom context compression reduces LLM token overhead by 60%–95% across bulky RAG chunks, JSON payloads, and MCP tool outputs.

## Implementation Details
- Service location: `apps/chat-api/src/context/headroom-compressor.ts`
- Integrated call site: `apps/chat-api/src/context/context-builder.ts` (`buildContext()`)
- Environment Control: `HEADROOM_ENABLED=true` (defaults to enabled, set `false` to bypass)

## CCR Pattern (Cache-Compress-Retrieve)
1. **Compress**: RAG context chunks and structural JSON are minified and trimmed before embedding into prompt templates.
2. **Cache**: Full uncompressed context is retained in the vector store and Firestore.
3. **Retrieve**: If LLM requires full context expansion, explicit retrieval tools fetch the uncompressed document.
