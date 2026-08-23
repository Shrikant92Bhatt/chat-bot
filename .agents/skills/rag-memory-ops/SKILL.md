# RAG & Memory Subsystem Skill

## 1. Dense Vector Search + Hybrid Reranking (RAG)
- **Vector Database**: `VectorDbAdapter` ([`apps/chat-api/src/rag/vector-db.ts`](file:///c:/Users/bhatt/Desktop/Work/AI/chat-bot/apps/chat-api/src/rag/vector-db.ts))
  - In-process cosine similarity search.
  - Multi-tenant SearchScope filtering (`ownerId` and optional `projectId`).
- **Hybrid Reranking**: `hybridRerank()` ([`apps/chat-api/src/rag/reranker.ts`](file:///c:/Users/bhatt/Desktop/Work/AI/chat-bot/apps/chat-api/src/rag/reranker.ts))
  - Reciprocal Rank Fusion (RRF) combining dense vector similarity + BM25 lexical search.
- **Context Retriever**: `RagRetriever` ([`apps/chat-api/src/rag/retriever.ts`](file:///c:/Users/bhatt/Desktop/Work/AI/chat-bot/apps/chat-api/src/rag/retriever.ts))
  - Rehydrates project knowledge bases from Firestore on demand.

## 2. Long-term Memory Architecture
- **Regex Gate (`looksMemorable`)**: Pre-filters inputs before any LLM extraction call ([`apps/chat-api/src/memory/extractor.ts`](file:///c:/Users/bhatt/Desktop/Work/AI/chat-bot/apps/chat-api/src/memory/extractor.ts)).
  - Rejects questions, general prompts, and text > 600 chars.
  - Only first-person facts/instructions pass to Gemini Flash extraction.
- **Memory Service**: `MemoryService` ([`apps/chat-api/src/memory/memory.service.ts`](file:///c:/Users/bhatt/Desktop/Work/AI/chat-bot/apps/chat-api/src/memory/memory.service.ts))
  - Single-field Firestore filters; sorting performed in-process to avoid index requirements.

## 3. Context Builder Pipeline
- **Single Context Path**: `buildContext()` ([`apps/chat-api/src/context/context-builder.ts`](file:///c:/Users/bhatt/Desktop/Work/AI/chat-bot/apps/chat-api/src/context/context-builder.ts))
  - Parallel `Promise.allSettled` execution for Projects, Memory, RAG, and Conversation Summarization.
  - Headroom CCR context compression integrated prior to template prompt assembly.
