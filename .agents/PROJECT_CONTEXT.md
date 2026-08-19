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
- `retriever.ts`: `RagRetriever.ingest()/retrieveContext()/enrichPrompt()` — real cosine-similarity search over documents added via `ingest()`
- `vector-db.ts`: `VectorDbAdapter` — in-memory store with a dependency-free hashing embedding (bag-of-words → 256-dim, L2-normalized). This is a working implementation, not a stub — but it's in-process (resets on restart) and not backed by a managed vector DB (no Pinecone/Weaviate/etc. provisioned). Nothing currently calls `ingest()`, so `retrieveContext()` returns `[]` until a document-loading path is added.

### `/mcp/` — Model Context Protocol
- `adapter.ts`: `McpAdapter.getTools()` (LangChain tool objects for binding) / `executeTool()`
- `tools.ts`: real LangChain `tool()` definitions with zod schemas — `system_calculator` does real sandboxed arithmetic, `generate_image` does a real GCS upload, `code_interpreter` does real sandboxed JS/TS execution (see `/tools/code-sandbox.ts` below); `web_search` has no backing provider configured and returns an explicit `{available: false}` rather than fabricated results — wire a search API (e.g. Tavily) to make it real

### `/tools/code-sandbox.ts` — Sandboxed Code Execution
- `executeSandboxedCode(code, { language })`: real JS/TypeScript execution backing `code_interpreter`, using `isolated-vm` (separate V8 Isolate per run, not Node's `vm` module which shares the host heap and isn't a security boundary).
- Isolation: memory limit via `Isolate({ memoryLimit })` (V8-enforced, verified by triggering it with a heap-growth loop); execution timeout enforced *both* by isolated-vm's own `script.run({ timeout })` *and* an independent host-side wall-clock `setTimeout` that force-disposes the isolate — testing showed isolated-vm's own timeout does not reliably bound a script whose returned promise never resolves (e.g. `await new Promise(() => {})`), so the wall-clock layer is required, not redundant. Filesystem and network access are blocked by omission (no `fs`/`require`/`fetch`/`net`/`process` is ever injected into the isolate's global scope — verified: `typeof require`, `typeof fetch`, `typeof process` are all `"undefined"` inside sandboxed code).
- Isolation level: isolate-level (separate V8 heap), not OS-process or container-level — same OS process/container as the API server, values crossing the boundary are explicitly copied. Weaker than a separate container/VM/gVisor sandbox, stronger than `vm.Script`. Cloud Run has no Docker-in-Docker/privileged mode available to run a heavier per-execution sandbox.
- TypeScript is transpiled via the `typescript` compiler API (`ts.transpileModule`, syntax-only strip, no type-checking) before running — `typescript` ships in the production image because `Dockerfile.api`'s builder stage runs a plain `npm ci` (installs devDependencies too) before copying `node_modules` into the runtime image.
- `isolated-vm@7` ships prebuilt native binaries for `linux-x64-musl` (matches `node:24-alpine`, the base image in `Dockerfile.api`) and `win32-x64` (local dev), so no C++ build toolchain is required at Docker build time.
- Python execution is NOT implemented (stretch goal, skipped — `node:24-alpine` has no `python3` runtime by default and OS-level resource limits for a subprocess couldn't be verified without changing the base image).

### Rate Limiting (`services/anon-usage.service.ts`)
- Firestore-backed (`rateLimits/{key}` collection), atomic check-and-increment via `firestore.runTransaction` - correct under concurrent Cloud Run instances, unlike the old in-memory `Map` it replaced (which reset on every redeploy and wasn't shared across instances).
- Two keyspaces: `anon:<ip>` (unauthenticated trial, checked in `authenticateOrAllowTrial` before any Bearer token exists) and `user:<uid>` (authenticated daily quota, checked once the token is verified). Both use a rolling window (`RATE_LIMIT_WINDOW_HOURS`, default 24h) rather than calendar-day reset.
- Limits are env-configurable: `ANON_TRIAL_MESSAGE_LIMIT` (default 1) and `AUTH_DAILY_MESSAGE_LIMIT` (default 20) - see Environment Variables below.
- Exceeding the anon limit returns 401 `SignInRequired` (existing behavior); exceeding the authenticated limit returns 429 `RateLimitExceeded` (new - previously signed-in users had no limit at all).

### Usage & Cost Tracking (`services/usage.service.ts`)
- Firestore-backed (`usage` collection, one document per completed chat request), doc ID = `requestId` (a generated UUID).
- Logged from `orchestration/graph.ts`'s `streamGraphResponse`, after the SSE response has fully ended (a Firestore write failure here is caught/logged, never surfaced to the client or allowed to delay the response).
- Record shape: `requestId, userId, tenantId (always null - no tenant/org model exists yet), conversationId (from the client's thread id, or null), model, inputTokens, outputTokens, latencyMs, estimatedCostUsd, timestamp`.
- Token counts come from LangChain's `on_chat_model_end` `usage_metadata`, which `@langchain/openai` populates from the gateway's real `usage` field (`ChatOpenAI` defaults `streamUsage: true`, sending `stream_options: {include_usage: true}`) - **verified working against OpenRouter**. The local/self-hosted OmniRoute gateway's support for `stream_options.include_usage` is **not verified** - if it doesn't return usage, `inputTokens`/`outputTokens`/`estimatedCostUsd` are logged as explicit `null` rather than guessed.
- `estimatedCostUsd` comes from a rough $/1K-token table per model (`MODEL_COST_PER_1K` in usage.service.ts), sourced from published list pricing at write-time, not queried live - treat it as directionally useful, not billing-accurate.
- `GET /api/chat/usage` (Bearer) returns the current user's most recent records, newest first (`?limit=` param, capped at 200). Query is `where('userId','==',uid).orderBy('timestamp','desc')`, which needs a Firestore composite index on the `usage` collection (`userId` ASC + `timestamp` DESC) - Firestore returns a console link to auto-create it on first use if it doesn't exist yet; there's no `firestore.indexes.json` checked into this repo to provision it ahead of time.
- The legacy `AIRouterService` fallback path (direct Gemini/OpenAI SDKs, only reached if the LangGraph gateway call fails before any token is streamed) does NOT log usage yet.

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
| POST | /api/chat/documents | Bearer | Upload a file into the user's RAG knowledge base |
| GET | /api/chat/usage | Bearer | Current user's recent usage/cost records (see Usage & Cost Tracking) |

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
| CODE_SANDBOX_TIMEOUT_MS | No | 5000 | `code_interpreter` execution wall-clock timeout, clamped server-side to [500, 15000]ms — not client/model-overridable |
| CODE_SANDBOX_MEMORY_MB | No | 64 | `code_interpreter` per-execution V8 isolate memory limit, clamped server-side to [8, 128]MB — not client/model-overridable |
| APP_SESSION_SECRET | Prod | random | JWT signing secret |
| ALLOWED_ORIGIN | No | * | CORS allowed origins |
| ANON_TRIAL_MESSAGE_LIMIT | No | 1 | Free messages an unauthenticated visitor (by IP) gets before sign-in is required |
| AUTH_DAILY_MESSAGE_LIMIT | No | 20 | Daily message quota per signed-in user (by uid) |
| RATE_LIMIT_WINDOW_HOURS | No | 24 | Rolling window (hours) both rate limits reset on |
| FIRESTORE_DATABASE_ID | No | (default) | Non-default Firestore database name, if one was created |
| FIREBASE_SERVICE_ACCOUNT_KEY | No | — | JSON-stringified service-account key (alternative to GOOGLE_APPLICATION_CREDENTIALS / Cloud Run ADC) |

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
| Tool/function calling (MCP) | ⚠️ real function calling; code_interpreter runs real sandboxed JS/TS (isolate-level, not OS-level isolation) via `isolated-vm`; web_search still has no backing provider |
| RAG context injection | ⚠️ real similarity search; nothing calls ingest() yet, so context is empty |
| Rate limiting (anon trial + per-user daily) | ✅ Firestore-backed, consistent across Cloud Run instances |
| Usage/cost tracking | ✅ real token counts when the gateway returns them, estimated $ cost |
| Session persistence (JWT) | ✅ |
| Docker deployment | ✅ |

## Build & Dev Commands
```bash
npm start              # Parallel serve (client + api)
npm run build:all      # Build all apps
npx nx serve chat-api  # API only
npx nx serve chat-client # Client only
```

## Infrastructure (Terraform)
Code-only Terraform scaffold lives under `infra/terraform/` (`environments/{dev,staging,prod}` +
`modules/{cloud-run,firestore,storage,pubsub,redis,iam,secret-manager,artifact-registry,monitoring}`).
It mirrors what `.github/workflows/ci-cd.yml` and `cloudbuild.yaml` already deploy via raw `gcloud`
commands (same region `asia-south1`, same Artifact Registry repo `chat-repo`, same Firestore DB
`nexus-ai`, same bucket `nexusai-generated-images` in prod) — see `infra/terraform/README.md` for the
full module-to-resource mapping and how an operator applies it. Nothing has been provisioned with it;
`pubsub` and `redis` are scaffolded for future async/rate-limiting work and aren't wired to app code yet.
