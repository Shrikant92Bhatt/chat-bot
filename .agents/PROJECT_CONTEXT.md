# NexusAI Enterprise Chat — Agent Reference

## System Overview
- Nx Monorepo: `apps/chat-client` (Angular 18 + Tailwind), `apps/chat-api` (Express TS), `libs/shared`
- Auth: Google OAuth2 -> App session JWT (7d)
- DB: Firestore (user registry, threads)
- Streaming: SSE via Express

## Architecture
```
chat-client -> /api/chat/stream -> LangGraph Orchestrator -> OmniRoute AI Gateway -> LLM
                                 -> MCP Tools (web_search, calculator, code_interpreter, generate_image)
                                 -> RAG Retriever -> Vector DB
                                 -> GCS Uploader -> Cloud Storage
```

## Backend Modules (`apps/chat-api/src/`)

### `/llm/client.ts` — Dual Gateway Client (OpenRouter preferred, local OmniRoute fallback)
- `getActiveGateway()`: if `OPENROUTER_API_KEY` is set, uses real OpenRouter (`https://openrouter.ai/api/v1`) — gives access to Gemini/GPT/Claude/Llama/Grok through one key. Otherwise falls back to `OMNIROUTE_API_KEY`/`OMNIROUTE_BASE_URL` (a local/self-hosted OmniRoute gateway, e.g. a dashboard app at `localhost:20128`). Both can be configured side by side; OpenRouter wins when present.
- `resolveOmniRouteModel()` maps app model IDs (`gemini-flash-latest`, `gpt-4o`, `claude-sonnet`, ...) to real OpenRouter slugs via `OPENROUTER_MODEL_SLUG_MAP` **only when OpenRouter is active** — verified against OpenRouter's live `/models` catalog, not guessed; re-check that catalog if a model starts 404ing ("model not found"), since OpenRouter renames/retires slugs over time. When the local OmniRoute gateway is active instead, model IDs pass through unchanged (it does its own provider resolution).
- `IMAGE_GENERATION_MODEL` (`google/gemini-2.5-flash-image`) is used by `llm/image-gen.ts` for real image generation via OpenRouter's `modalities: ["image","text"]` — OpenRouter-specific, not validated against the local OmniRoute gateway.
- `mockStream()` fallback only used if callers explicitly want a stub; the graph itself does NOT fall back silently (see below)

### `/orchestration/` — Real LangGraph StateGraph
- `state.ts`: `AgentStateAnnotation` (LangGraph `Annotation.Root`, extends `MessagesAnnotation`) — messages, model, temperature, mcpEnabled, ragContext, generatedImageUrl
- `nodes.ts`: `agentNode` (invokes ChatOpenAI, binds MCP tools via `.bindTools()` for real function calling), `toolsNode` (executes requested tool calls, appends `ToolMessage`s), `shouldContinue` (routes on `AIMessage.tool_calls`)
- `graph.ts`: compiles an actual `StateGraph(AgentStateAnnotation)` with agent↔tools loop; `streamGraphResponse()` uses `streamEvents()` to forward real token chunks over SSE
- **Fallback contract**: if the OmniRoute call fails before any token has been written to the response, `streamGraphResponse` rethrows so `chat.routes.ts` falls back to the legacy `AIRouterService` (direct Gemini/OpenAI SDKs). If it fails mid-stream, an error event is sent and the stream ends (no fallback — response already started). Verified via manual test: unreachable gateway → `APIConnectionError` propagates → fallback path is reachable.

### `/storage/` — GCP Cloud Storage
- `uploader.ts`: real `@google-cloud/storage` `Storage.bucket().file().save()`; falls back to a mock URL (no network call) only when `GCS_BUCKET_NAME` + `GOOGLE_APPLICATION_CREDENTIALS` aren't both set
- `metrics.ts`: real `bucket.getFiles()` + byte sum when configured; returns explicit `configured: false` + zeroed metrics otherwise (never fabricates numbers)
- Env: GCS_BUCKET_NAME, GOOGLE_APPLICATION_CREDENTIALS
- Cost rate: $0.020/GB/month
- No image-generation model (DALL-E/Imagen) is wired in yet — `generate_image` tool and `/generate-image` route upload a 1x1 placeholder PNG so the storage path is real; swap the placeholder for an actual image-gen call when a provider is chosen

### `/rag/` — Retrieval-Augmented Generation
- Flow: `Vector Search → Fusion → Reranker → Top K Chunks`, all inside `RagRetriever.retrieveContext()`.
  1. **Vector Search**: `VectorDbAdapter.similaritySearch()` does cosine similarity over the hashing embedding, over-fetching `max(topK * 4, 10)` candidates (not just `topK`) so the reranker has real material to reorder instead of just re-sorting an already-truncated top-3. Candidates below `RagRetriever.RELEVANCE_THRESHOLD` (0.12, tuned to the raw cosine score) are dropped here, before reranking.
  2. **Fusion + Reranker**: `reranker.ts`'s `hybridRerank()` — blends the vector-similarity ranking with an independent lexical signal (BM25-style term overlap, corpus-relative IDF computed over just the candidate pool, English stopwords filtered from the query terms) via **Reciprocal Rank Fusion (RRF)**. RRF combines by rank position rather than raw score, which matters because cosine (0..1, dense) and BM25 (unbounded, sparse) live on incomparable scales — fusing by rank avoids hand-tuned score normalization.
  3. **Top K Chunks**: fused ranking is truncated to `topK` and returned as `string[]` (unchanged external contract — `enrichPrompt()` and `chat.routes.ts`/`orchestration/graph.ts` callers are unaffected).
  - **Why lexical fusion, not a second embeddings pass**: the hashing embedding (see below) isn't a real semantic model, so re-embedding and comparing again would just reproduce the same cosine ranking with hash noise — no new signal. A cheap, independent lexical signal (BM25 has no IDF-blindness the way raw cosine-on-term-frequency does) is where the actual correction comes from. Manually verified: a short, genuinely on-topic chunk can be outranked by cosine alone by a longer chunk that happens to repeat common query words (no IDF in the hashing embedding) — hybrid reranking correctly promotes the on-topic chunk back to #1.
  - **Latency**: reranking is O(candidates × queryTerms), in-process, no I/O — negligible against the project's <300ms RAG retrieval budget (candidate pools here are a handful of chunks per user).
  - **Optional LLM reranker** (`reranker.ts`'s `llmRerank()`, via `llm/client.ts`'s gateway): explicit opt-in only, via `retrieveContext(ownerId, query, topK, { useLlmRerank: true })`. NOT on the default path — a non-streaming LLM call is easily 500ms–2s+, well over the latency budget, so it's layered on top of the hybrid-reranked shortlist for callers who want it for higher-value queries, not wired into the hot path.
- `retriever.ts`: `RagRetriever.ingest()/retrieveContext()/enrichPrompt()` — real cosine-similarity search + hybrid rerank over documents added via `ingest()`
- `vector-db.ts`: `VectorDbAdapter` — in-memory store with a dependency-free hashing embedding (bag-of-words → 256-dim, L2-normalized). This is a working implementation, not a stub — but it's in-process (resets on restart) and not backed by a managed vector DB (no Pinecone/Weaviate/etc. provisioned).

### `/mcp/` — Model Context Protocol
- `adapter.ts`: `McpAdapter.getTools()` (LangChain tool objects for binding) / `executeTool()`
- `tools.ts`: real LangChain `tool()` definitions with zod schemas — `system_calculator` does real sandboxed arithmetic, `generate_image` does a real GCS upload; `web_search` and `code_interpreter` have no backing provider configured and return an explicit `{available: false}` rather than fabricated results — wire a search API (e.g. Tavily) / sandbox runtime to make them real

### Existing Services (kept as fallback)
- `services/gemini.service.ts`: Direct Gemini SDK streaming
- `services/openai.service.ts`: Direct OpenAI SDK streaming
- `services/ai-router.service.ts`: Legacy multi-LLM router (Gemini/OpenAI dispatch)

## Frontend Components (`apps/chat-client/src/app/`)

### Layout
- `app.component`: Root shell — navbar, sidebar, chat-window, message-input, modals
- `navbar.component`: Brand, model dropdown selector, settings gear, user profile
- `sidebar.component`: Thread history list, new thread button, settings button

### Chat
- `chat-window.component`: Stream-aligned message rendering (no card borders), user profile identity, markdown rendering, copy, suggestions
- `message-input.component`: Auto-resize textarea, send/stop buttons, disclaimer footer

### Modals
- `settings-modal.component`: Tabs (General, Diagnostics, Storage) — MCP/RAG/OmniRoute status, GCS metrics
- `session-expired-modal.component`: Re-authentication prompt
- `login-error-toast.component`: Sign-in failure toast

### Services
- `auth.service.ts`: Google OAuth2 flow, session storage, JWT decode, token management
- `chat.service.ts`: Thread CRUD, SSE stream consumption, model selection, MCP toggle

## API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | None | Healthcheck |
| GET | /api/chat/config | None | Client ID + feature flags |
| POST | /api/chat/stream | Bearer | SSE LLM streaming (LangGraph) |
| GET | /api/chat/models | Bearer | Available model list |
| GET | /api/chat/users | Bearer | Registered users |
| GET | /api/chat/threads | Bearer | User's thread history |
| PUT | /api/chat/threads | Bearer | Save thread history |
| POST | /api/auth/session | Bearer (Google) | Exchange Google token for app session |
| GET | /api/chat/storage/metrics | Bearer/None | GCS bucket size & cost |
| POST | /api/chat/generate-image | Bearer | Image generation + GCS upload |

## Shared Types (`libs/shared/src/interfaces/chat.interface.ts`)
- AIModelType: gemini-1.5-pro | gemini-1.5-flash | gemini-pro-latest | gemini-flash-latest | gpt-4o | gpt-4o-mini | omniroute-default
- ChatMessage, ChatThread, ChatStreamRequest, UserSession, AIProviderResponse
- StorageMetricsResponse, ImageGenerationRequest/Response, SystemDiagnostics

## Environment Variables
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| PORT | No | 3000 | API server port |
| GOOGLE_CLIENT_ID | Yes | — | Google OAuth2 client ID |
| GEMINI_API_KEY | Yes | — | Google Gemini API key |
| OPENAI_API_KEY | No | — | OpenAI API key (enables GPT models) |
| OPENROUTER_API_KEY | No | — | Real OpenRouter key (`sk-or-v1-...`) — preferred gateway when set |
| OPENROUTER_BASE_URL | No | https://openrouter.ai/api/v1 | OpenRouter endpoint |
| OMNIROUTE_BASE_URL | No | http://localhost:20128/v1 | Local/self-hosted OmniRoute gateway URL - used only when OPENROUTER_API_KEY is unset |
| OMNIROUTE_API_KEY | No | — | Local OmniRoute gateway API key |
| GCS_BUCKET_NAME | No | nexusai-generated-images | GCS bucket for images |
| GOOGLE_APPLICATION_CREDENTIALS | No | — | GCP service account JSON path |
| APP_SESSION_SECRET | Prod | random | JWT signing secret |
| ALLOWED_ORIGIN | No | * | CORS allowed origins |

## Feature Parity Matrix (ChatGPT / Gemini)
| Feature | Status |
|---------|--------|
| Streaming SSE responses | ✅ |
| Markdown rendering (GFM) | ✅ |
| Code syntax highlighting | ✅ |
| Model selector dropdown | ✅ |
| Follow-up suggestions | ✅ |
| Copy message to clipboard | ✅ |
| User profile identity | ✅ |
| Chat thread history | ✅ |
| Image generation | ✅ real, via OpenRouter `google/gemini-2.5-flash-image` + GCS (or inline data URI if GCS unconfigured) |
| Tool/function calling (MCP) | ⚠️ real function calling; web_search/code_interpreter have no backing provider |
| RAG context injection | ✅ real similarity search + hybrid rerank; wired end-to-end via `POST /api/chat/documents` → `ingest()` |
| Rate limiting (anon trial) | ✅ |
| Session persistence (JWT) | ✅ |
| Docker deployment | ✅ |

## Build & Dev Commands
```bash
npm start              # Parallel serve (client + api)
npm run build:all      # Build all apps
npx nx serve chat-api  # API only
npx nx serve chat-client # Client only
```
