# NexusAI Enterprise Chat — Agent Reference

## System Overview
- Nx Monorepo: `apps/chat-client` (Angular 18 + Tailwind), `apps/chat-api` (Express TS), `libs/shared`
- Auth: Google OAuth2 -> App session JWT (7d)
- DB: Firestore — collections: `users` (registry) / `users/{uid}/threads` (conversations + rolling summary), `projects` (+ `projects/{id}/files` subcollection), `memories` (long-term user facts)
- Streaming: SSE via Express

## Architecture
```
chat-client -> /api/chat/stream -> Context Assembly -> LangGraph Orchestrator -> OmniRoute AI Gateway -> LLM
                                   |                   -> MCP Tools (web_search, calculator, code_interpreter, generate_image)
                                   |                   -> GCS Uploader -> Cloud Storage
                                   |
                                   +-- Project instructions (Firestore `projects`)
                                   +-- Long-term memory   (Firestore `memories`)
                                   +-- RAG excerpts       (Vector DB, user- and project-scoped)
                                   +-- Conversation summary (Firestore thread doc)
                                           |
                                           v
                                   Prompt Manager -> one system message
```

### Context assembly — read this before touching the chat pipeline
Four features share one code path, deliberately:
1. `context/context-builder.ts` `buildContext()` — the single gathering step, called once per request from `orchestration/graph.ts`. Runs project lookup + memory retrieval + RAG + summarization in `Promise.allSettled`, so **any one of them failing degrades the answer but never breaks the turn**.
2. The result lands in LangGraph state as `assembledContext`.
3. `orchestration/nodes.ts` `assembleAgentMessages()` — pure, cheap, re-run on every pass of the agent↔tools loop — turns that bundle into the system message via the Prompt Manager, and strips any client-supplied `SystemMessage` so nothing competes with project instructions.
4. Write-back: `recordTurnMemories()` runs **after** the stream ends, un-awaited, so memory extraction never adds latency.

Do not re-add inline prompt strings to `nodes.ts` / `graph.ts` — add a template to `prompt/templates.ts` instead.

## Backend Modules (`apps/chat-api/src/`)

### `/llm/client.ts` — Dual Gateway Client (OpenRouter preferred, local OmniRoute fallback)
- `getActiveGateway()`: if `OPENROUTER_API_KEY` is set, uses real OpenRouter (`https://openrouter.ai/api/v1`) — gives access to Gemini/GPT/Claude/Llama/Grok through one key. Otherwise falls back to `OMNIROUTE_API_KEY`/`OMNIROUTE_BASE_URL` (a local/self-hosted OmniRoute gateway, e.g. a dashboard app at `localhost:20128`). Both can be configured side by side; OpenRouter wins when present.
- `resolveOmniRouteModel()` maps app model IDs (`gemini-flash-latest`, `gpt-4o`, `claude-sonnet`, ...) to real OpenRouter slugs via `OPENROUTER_MODEL_SLUG_MAP` **only when OpenRouter is active** — verified against OpenRouter's live `/models` catalog, not guessed; re-check that catalog if a model starts 404ing ("model not found"), since OpenRouter renames/retires slugs over time. When the local OmniRoute gateway is active instead, model IDs pass through unchanged (it does its own provider resolution).
- `IMAGE_GENERATION_MODEL` (`google/gemini-2.5-flash-image`) is used by `llm/image-gen.ts` for real image generation via OpenRouter's `modalities: ["image","text"]` — OpenRouter-specific, not validated against the local OmniRoute gateway.
- `mockStream()` fallback only used if callers explicitly want a stub; the graph itself does NOT fall back silently (see below)

### `/prompt/` — Prompt Manager (versioned template registry)
- `templates.ts`: `PROMPT_TEMPLATES`, keyed `<id>:<version>` (`system:v1`, `chat:v1`, `rag:v1`, `memory:v1`, `memory_extraction:v1`, `summarization:v1`, `conversation_summary:v1`, `project:v1`, `tool_selection:v1`). Plain `{{var}}` interpolation — no templating engine. Add a `v2` next to a `v1` and flip the key at the call site to roll a prompt change out/back.
- `prompt-manager.ts`: `renderPrompt(key, vars)`, `buildSystemPrompt(context, {mcpEnabled})`, `listPromptTemplates()`, `estimateTokens()` (~chars/4).
- `buildSystemPrompt` block order is deliberate — **identity → tool policy → project instructions → memories → RAG → conversation summary** (most durable first, most volatile last, so late blocks read as "for this turn").
- This module is the ONLY place prompt text lives. `rag/retriever.ts`'s old `enrichPrompt()` was removed in favour of it.

### `/memory/` — Long-term user memory
- `extractor.ts`: two-stage. `looksMemorable()` is a **regex gate that runs first with no network call** — first-person statements about the user (name/role/employer/location/stable preferences) or explicit "remember this"; rejects questions, task requests, messages < 8 or > 600 chars. Only survivors get a single cheap Gemini Flash call (`memory_extraction:v1`) that normalises them to short third-person statements and can still veto. No Gemini key ⇒ heuristic-only (stores the trimmed sentence).
- `memory.service.ts`: `MemoryService.getRelevantMemories(userId, query)` / `rememberFromMessage()` / `listMemories()` / `deleteMemory()`. Firestore top-level `memories` collection, single-field `where('userId','==',uid)` (**no composite index needed** — scoring/sorting happen in process). Retrieval is keyword overlap, not embeddings: the set is capped at 200/user and entries are short sentences. `identity` + `instruction` memories are ALWAYS injected (standing directives); `fact`/`preference` must clear a relevance threshold. Dedupes on normalised content.
- Distinct from RAG (documents) and from thread history (single conversation) — this is small, user-scoped and cross-thread.

### `/summarization/` — Conversation summarization
- `summarizer.ts`: `SummarizationService.buildConversationContext({uid, threadId, messages})`. Triggers when **either** >20 messages or >6000 estimated tokens; keeps the last 8 turns verbatim and folds the rest into a rolling summary (incremental — the previous summary is fed back in, not re-summarized from scratch).
- Persisted on the thread doc (`summary`, `summarizedThroughIndex`, `summaryUpdatedAt`) via `ThreadService.getThreadSummary/saveThreadSummary`, and mirrored in a bounded process-level cache so anonymous/threadless sessions don't re-summarize every turn.
- **Fallback contract**: if summarization is unavailable (no Gemini key, call failed) it returns the FULL history rather than silently truncating context.

### `/projects/` — Projects
- `project.service.ts`: CRUD over a top-level `projects` collection (`where('ownerId','==',uid)`), with a `files` subcollection per project. Ownership is checked on every read/write — a project owned by someone else is indistinguishable from a nonexistent one (404), so ids can't be probed.
- File docs store the extracted **text** alongside metadata. That's what makes project knowledge survive a restart: `RagRetriever.ensureProjectHydrated()` re-ingests it into the in-process vector store on first use per process. (The personal knowledge base has no such backing and still resets on restart.)

### `/context/` — The single context-assembly step
- `context-builder.ts`: `buildContext()` (gather, `Promise.allSettled`, fail-soft) and `recordTurnMemories()` (fire-and-forget write-back after the stream). See "Context assembly" above.

### `/orchestration/` — Real LangGraph StateGraph
- `state.ts`: `AgentStateAnnotation` (LangGraph `Annotation.Root`, extends `MessagesAnnotation`) — messages, model, temperature, mcpEnabled, ragContext, generatedImageUrl, **assembledContext, userId, projectId, threadId**
- `nodes.ts`: `assembleAgentMessages` (builds the system message from `assembledContext` via the Prompt Manager — the one context-assembly point for the LLM call), `agentNode` (invokes ChatOpenAI, binds MCP tools via `.bindTools()` for real function calling), `toolsNode` (executes requested tool calls, appends `ToolMessage`s), `shouldContinue` (routes on `AIMessage.tool_calls`)
- `graph.ts`: compiles an actual `StateGraph(AgentStateAnnotation)` with agent↔tools loop; `streamGraphResponse()` uses `streamEvents()` to forward real token chunks over SSE
- **Fallback contract**: if the OmniRoute call fails before any token has been written to the response, `streamGraphResponse` rethrows so `chat.routes.ts` falls back to the legacy `AIRouterService` (direct Gemini/OpenAI SDKs). If it fails mid-stream, an error event is sent and the stream ends (no fallback — response already started). Verified via manual test: unreachable gateway → `APIConnectionError` propagates → fallback path is reachable.

### `/storage/` — GCP Cloud Storage
- `uploader.ts`: real `@google-cloud/storage` `Storage.bucket().file().save()`; falls back to a mock URL (no network call) only when `GCS_BUCKET_NAME` + `GOOGLE_APPLICATION_CREDENTIALS` aren't both set
- `metrics.ts`: real `bucket.getFiles()` + byte sum when configured; returns explicit `configured: false` + zeroed metrics otherwise (never fabricates numbers)
- Env: GCS_BUCKET_NAME, GOOGLE_APPLICATION_CREDENTIALS
- Cost rate: $0.020/GB/month
- No image-generation model (DALL-E/Imagen) is wired in yet — `generate_image` tool and `/generate-image` route upload a 1x1 placeholder PNG so the storage path is real; swap the placeholder for an actual image-gen call when a provider is chosen

### `/rag/` — Retrieval-Augmented Generation
- `retriever.ts`: `RagRetriever.ingest(id, ownerId, content, metadata, projectId?)` / `retrieveContext(ownerId, query, topK, projectId?)` — real cosine-similarity search. Prompt injection moved out to the Prompt Manager (`enrichPrompt()` was removed).
- `vector-db.ts`: `VectorDbAdapter` — in-memory store with a dependency-free hashing embedding (bag-of-words → 256-dim, L2-normalized). Working implementation, not a stub — but in-process (resets on restart) and not backed by a managed vector DB.
- **Scoping rule** (`VectorDbAdapter.inScope`): a doc is visible when `ownerId` matches AND (`projectId === null` OR it equals the conversation's project). So a project's files never surface outside that project or in another project, while the user's personal knowledge base stays visible everywhere. Re-ingesting the same id replaces rather than duplicates.
- Ingest paths: `POST /api/chat/documents` (personal, `projectId = null`) and `POST /api/v1/projects/:id/files` (project-scoped, and rehydratable from Firestore).

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
- `projects-modal.component`: Projects workspace — list / create / rename, custom-instructions textarea, per-project file upload + file list, delete, "Start chat in project"
- `session-expired-modal.component`: Re-authentication prompt
- `login-error-toast.component`: Sign-in failure toast

### Services
- `auth.service.ts`: Google OAuth2 flow, session storage, JWT decode, token management
- `chat.service.ts`: Thread CRUD, SSE stream consumption, model selection, MCP toggle. Sends `threadId` + `projectId` with every stream request; `createNewThread(projectId?)` scopes a conversation to a project; `activeProjectId` computed.
- `project.service.ts`: `/api/v1/projects` client — signals `projects`, `selectedProject(Id)`, `selectedProjectFiles`, `isLoading`, `isUploadingFile`, `error`. Reloads on login, clears on logout.

### Where the Projects UI lives
- Sidebar: a "Projects" section above thread history (click a project = new chat scoped to it; `+` opens the modal). Threads show their project name as a sub-label.
- Message input: a project badge in the composer's top row when the conversation is scoped.

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
| POST | /api/chat/documents | Bearer | Upload a file into the personal RAG knowledge base |
| GET | /api/chat/memories | Bearer | Long-term memories saved about the user |
| DELETE | /api/chat/memories/:id | Bearer | Forget one memory |
| GET | /api/chat/prompts | Bearer | Prompt registry (keys + descriptions, not bodies) |
| POST | /api/v1/projects | Bearer | Create a project |
| GET | /api/v1/projects | Bearer | List the caller's projects |
| GET | /api/v1/projects/:id | Bearer | One project + its file metadata |
| PATCH | /api/v1/projects/:id | Bearer | Rename / edit instructions |
| DELETE | /api/v1/projects/:id | Bearer | Delete project + its files subcollection |
| GET | /api/v1/projects/:id/files | Bearer | Project file metadata |
| POST | /api/v1/projects/:id/files | Bearer | Upload a file into the project's knowledge base |

> CORS `methods` in `main.ts` must include PUT/PATCH/DELETE — the thread-save and project CRUD routes preflight-fail in production without them.

## Shared Types (`libs/shared/src/interfaces/chat.interface.ts`)
- AIModelType: gemini-1.5-pro | gemini-1.5-flash | gemini-pro-latest | gemini-flash-latest | gpt-4o | gpt-4o-mini | omniroute-default
- ChatMessage, ChatThread, ChatStreamRequest, UserSession, AIProviderResponse
- StorageMetricsResponse, ImageGenerationRequest/Response, SystemDiagnostics
- **Project, ProjectFile, ProjectListResponse, ProjectFileListResponse, MemoryEntry, MemoryKind**
- `ChatThread` gained `projectId`, `summary`, `summarizedThroughIndex`, `summaryUpdatedAt` (server-written summary fields round-trip through the client's `PUT /api/chat/threads`; that save is `merge:true` so an older client can't wipe them).
- `ChatStreamRequest` gained `threadId` and `projectId`.

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
| RAG context injection | ✅ real similarity search, user- and project-scoped; fed by both upload routes |
| Projects (instructions + files) | ✅ CRUD + scoped ingest + context injection + UI |
| Long-term memory | ✅ gated extraction, Firestore-backed, injected via Prompt Manager |
| Conversation summarization | ✅ threshold-triggered rolling summary, persisted on the thread doc |
| Prompt management | ✅ versioned registry; all prompt text centralised |
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

### Building from a git worktree (gotcha)
If `node_modules` in a worktree is a junction/symlink to the main checkout, Nx resolves its workspace root through the symlink's real path and **silently builds the main checkout's source instead of the worktree's**. Set `NX_WORKSPACE_ROOT_PATH=<absolute path to the worktree>` for the build to actually compile your changes. Sanity check: `dist/` should appear inside the worktree, not the main checkout.

## Known gaps / limitations
- The personal RAG knowledge base is still in-process only — it resets on restart and is not shared across Cloud Run instances. Project files are the exception (rehydrated from Firestore).
- On the legacy fallback path (`AIRouterService`, used when the LangGraph call fails before any token is written), the assembled context is NOT re-applied — that turn loses project instructions/memories/summary.
- Memory extraction only reads the latest **user** message; facts stated by the assistant are never stored.
- `summarizedThroughIndex` indexes into the message array the client sends. There is no edit/regenerate feature, so indices are stable; adding one would need this revisited.
