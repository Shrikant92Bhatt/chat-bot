# NexusAI Enterprise Chat — Agent Reference

## System Overview
- Nx Monorepo: `apps/chat-client` (Angular + Tailwind), `apps/chat-api` (Express TS), `libs/shared` (types), `libs/frontend/admin-analytics` (admin console, consumed directly into chat-client's build — not a separate deployment)
- Auth: Google OAuth2 -> App session JWT (7d). Authorization: a `role` field (`'user' | 'admin'`) on the `users` doc, re-read from Firestore on every admin request (never a JWT claim)
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
- Flow: `Vector Search → Fusion → Reranker → Top K Chunks`, all inside `RagRetriever.retrieveContext(ownerId, query, topK, projectId?, options?)`.
  1. **Vector Search**: `VectorDbAdapter.similaritySearch(scope, ...)` does cosine similarity over the hashing embedding, scoped by `{ ownerId, projectId }` (see Scoping rule below), over-fetching `max(topK * 4, 10)` candidates (not just `topK`) so the reranker has real material to reorder instead of just re-sorting an already-truncated top-3. Candidates below `RagRetriever.RELEVANCE_THRESHOLD` (0.12, tuned to the raw cosine score) are dropped here, before reranking.
  2. **Fusion + Reranker**: `reranker.ts`'s `hybridRerank()` — blends the vector-similarity ranking with an independent lexical signal (BM25-style term overlap, corpus-relative IDF computed over just the candidate pool, English stopwords filtered from the query terms) via **Reciprocal Rank Fusion (RRF)**. RRF combines by rank position rather than raw score, which matters because cosine (0..1, dense) and BM25 (unbounded, sparse) live on incomparable scales — fusing by rank avoids hand-tuned score normalization.
  3. **Top K Chunks**: fused ranking is truncated to `topK` and returned as `string[]` (external contract used by `context/context-builder.ts`, the sole caller).
  - **Why lexical fusion, not a second embeddings pass**: the hashing embedding (see below) isn't a real semantic model, so re-embedding and comparing again would just reproduce the same cosine ranking with hash noise — no new signal. A cheap, independent lexical signal (BM25 has no IDF-blindness the way raw cosine-on-term-frequency does) is where the actual correction comes from. Manually verified: a short, genuinely on-topic chunk can be outranked by cosine alone by a longer chunk that happens to repeat common query words (no IDF in the hashing embedding) — hybrid reranking correctly promotes the on-topic chunk back to #1.
  - **Latency**: reranking is O(candidates × queryTerms), in-process, no I/O — negligible against the project's <300ms RAG retrieval budget (candidate pools here are a handful of chunks per user).
  - **Optional LLM reranker** (`reranker.ts`'s `llmRerank()`, via `llm/client.ts`'s gateway): explicit opt-in only, via `retrieveContext(ownerId, query, topK, projectId, { useLlmRerank: true })`. NOT on the default path — a non-streaming LLM call is easily 500ms–2s+, well over the latency budget, so it's layered on top of the hybrid-reranked shortlist for callers who want it for higher-value queries, not wired into the hot path.
- `retriever.ts`: `RagRetriever.ingest(id, ownerId, content, metadata, projectId?)` / `retrieveContext(ownerId, query, topK, projectId?, options?)` — real cosine-similarity search + hybrid rerank over documents added via `ingest()`. Prompt injection moved out to the Prompt Manager (the old `enrichPrompt()` method was removed).
- `vector-db.ts`: `VectorDbAdapter` — in-memory store with a dependency-free hashing embedding (bag-of-words → 256-dim, L2-normalized). Working implementation, not a stub — but in-process (resets on restart) and not backed by a managed vector DB (no Pinecone/Weaviate/Vertex AI Vector Search provisioned — **not required** for this to work, just for it to survive a restart/scale across instances).
- **Scoping rule** (`VectorDbAdapter`'s `SearchScope`/`inScope`): a doc is visible when `ownerId` matches AND (`projectId === null` OR it equals the conversation's project). So a project's files never surface outside that project or in another project, while the user's personal knowledge base stays visible everywhere. Re-ingesting the same id replaces rather than duplicates.
- Ingest paths: `POST /api/chat/documents` (personal, `projectId = null`) and `POST /api/v1/projects/:id/files` (project-scoped, and rehydratable from Firestore via `ensureProjectHydrated()`).

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

### Admin Analytics (`middleware/admin.middleware.ts`, `routes/admin.routes.ts`, `services/analytics.service.ts`)
- **Bootstrapping the first admin**: `scripts/migrate-add-user-roles.ts` — a one-time, idempotent backfill that adds `role: 'user'` to every `users/{uid}` doc missing one, and promotes a hardcoded email allowlist to `role: 'admin'`. Run once via `node dist/apps/chat-api/.../scripts/migrate-add-user-roles.js` after building. Ongoing promotion/demotion goes through the admin API instead (below), which requires an existing admin to already be signed in — this script is only for getting that first one.
- **Authorization**: `requireAdmin` runs AFTER `authenticateToken` and does a **fresh Firestore read** of `users/{uid}.role` on every request. The role is deliberately NOT a JWT claim — the session token lives 7 days, so a baked-in claim would keep a demoted admin privileged for up to a week. It **fails closed**: a Firestore error denies rather than degrades (the opposite of the fail-soft context-assembly paths, on purpose). Non-admins get `403 {error:'Forbidden', message:'Admin access required.'}`.
- `admin.routes.ts` applies `router.use(authenticateToken, requireAdmin)` at the router level, so a route added later can't be left unguarded by accident.
- **Last-admin guard**: `PATCH /users/:uid/role` counts current admins before a demotion and rejects with `400 LastAdmin` if the target is the only one left. There is currently exactly one admin, so this is a live safety net, not a hypothetical.
- `AnalyticsService` aggregates the `usage` collection **in process** — Firestore has no server-side GROUP BY. Every query filters on `timestamp` only (single field ⇒ no composite index needed, per the Firestore query rules below); per-user/per-model narrowing happens in memory for the same reason. Cost/latency grow linearly with logged requests: `MAX_RECORDS_SCANNED` (20k) caps the blast radius and responses carry `truncated: true` when it's hit rather than silently reporting a partial total as complete. **A scheduled BigQuery export is the intended path at real volume** (Firestore for app-level, BigQuery for large-scale — the pattern architecture.md already calls out).

### Existing Services (kept as fallback)
- `services/gemini.service.ts`: Direct Gemini SDK streaming
- `services/openai.service.ts`: Direct OpenAI SDK streaming
- `services/ai-router.service.ts`: Legacy multi-LLM router (Gemini/OpenAI dispatch)

## Frontend Components (`apps/chat-client/src/app/`)

### Layout
- `app.component`: Root shell — navbar, sidebar, chat-window, message-input, modals
- `navbar.component`: Brand, model dropdown selector, settings gear, user profile
- `sidebar.component`: Thread history list (skeleton-loader placeholder while `chatService.isLoadingThreads()`), new thread button, settings button

### Chat
- `chat-window.component`: Stream-aligned message rendering (no card borders), user profile identity, markdown rendering, copy, suggestions. Auto-scroll: `(wheel)`/`(touchstart)` on the scroll container set `shouldAutoScroll=false` the instant the user starts a manual gesture (intent-based, not inferred from the resulting `scroll` event) — needed because during active streaming every token is a *real* scroll, so a "was this scroll programmatic" check loses the race almost every time. `onScroll()` only re-enables auto-follow once the user scrolls back within `bottomThresholdPx` of the bottom themselves. Verified live: scroll-up sticks through an entire active stream (content genuinely growing underneath), and scrolling back to bottom correctly resumes auto-follow for the rest of that same stream.
  - Message action bar (Copy/Regenerate/Share/Edit) is touch-visible by default (`opacity-100`, only gated behind `md:group-hover` on desktop) with a `focus-visible` reveal + ring for keyboard users — a real bug fixed after the fact (the buttons were focusable-but-invisible on desktop keyboard nav).
  - Empty-state capability chips ("Analyze a document", "Search the web", "Check a stock price", "Write code") prefill the composer via `ChatService.composerDraft`/`prefillComposer()` — never auto-send.
- `message-input.component`: Auto-resize textarea, send/stop buttons, disclaimer footer. Bottom padding includes `env(safe-area-inset-bottom)` (needs `viewport-fit=cover` in `index.html`, already set) for iOS home-indicator clearance. Also drives Edit-message mode (see below) via `ChatService.editingMessageId()`.

### Edit message (`ChatService.startEditingMessage`/`editLastUserMessage`)
Deliberately restricted to the LAST user message in the active thread only — same reason `regenerateLastResponse()` is last-message-only: `ChatThread.summarizedThroughIndex` assumes stable message-array indices (see Known gaps below), and editing an earlier turn would invalidate it. `isLastUserMessage(msg)` gates the Edit button; `editLastUserMessage()` replaces that message's content in place and re-runs the trailing assistant reply through the same reset-in-place shape `regenerateLastResponse()` already established (drops the old reply's `ui`/`sources`/`actions`/`suggestions`, keeps the message id). Escape or the composer's own Cancel control exits edit mode without sending.

### Structured UI — progressive streaming, not just a trailing fenced block
The `ui`/`sources`/`actions` payload described in `libs/shared/src/interfaces/orchestrator.interface.ts` still exists exactly as documented above (a trailing ` ```ui ` fenced block the model appends, extracted/validated by `orchestration/ui-schema.ts`), but two tool-backed component types — `WEATHER_CARD` and `STOCK_CARD` — no longer wait for that trailing block:
- `orchestration/ui-tool-adapter.ts` (`TOOL_UI_COMPONENT_MAP`, `normalizeToolResultForUi`) normalizes `get_weather`/`get_stock_quote`'s raw tool result directly into the approved component shape.
- `orchestration/graph.ts` emits a `ui_start` event the instant the model calls one of those tools (before the tool even resolves) and a `ui_update`/`ui_error` event the instant it does — see `libs/shared/src/interfaces/ui-stream.interface.ts` (`UIStreamEvent`, `UI_STREAM_EVENT_NAME`). These ride the same SSE stream as everything else, as `{uiEvent, done:false}`, mirroring the `research`-event pattern (`ResearchStreamEvent`) this app already used for research progress.
- Client-side, `chat.service.ts`'s `applyUiStreamEvent()` folds these into a message's transient `pendingUi: PendingUIBlock[]` (rendered as a loading/error card by `ui-block.component`) and promotes a resolved `ui_update` straight into the message's real, persisted `ui` array — so the card is on screen before the rest of the reply has even finished streaming, not just after the trailing fenced block is parsed. The tool-sourced components are also folded into the final `done:true` payload's `ui` array (deduped by id against anything the model separately declared in its own fenced block), so a reload/regenerate renders identically to the live view.
- The `ui_orchestrator` prompt (now `:v2`, `prompt/templates.ts`) tells the model NOT to re-emit a `WEATHER_CARD`/`STOCK_CARD` for the same data the app already rendered from the tool call (avoids a visible duplicate), and separately warns against ever echoing a tool's raw JSON into the Markdown prose, fenced or not.
- Every other component type (`TABLE`, `CHART`, `NEWS_CARD`, `MAP`, `PRODUCT_CARD`, etc.) still only ever arrives via the trailing fenced block — there's no dedicated backend tool producing that data, so there's nothing to stream progressively.
- **Defense-in-depth against a JSON leak**: `orchestration/tool-leak-stream-filter.ts` (`ToolResultLeakStreamFilter`, chained after `UiBlockStreamFilter` in `graph.ts`'s SSE loop) withholds a `{` that's followed, within a bounded lookahead, by 2+ of a curated list of field names from `WeatherResult`/`StockQuoteResult` — a narrow, best-effort backstop for when the model narrates a tool result in prose without the fence at all. It is NOT a general JSON detector and doesn't guarantee anything — read its own doc comment for the precise, honest scope of what it does and doesn't catch (in particular: its fenced-code-block exemption is a toggle-on-` ``` ` heuristic, not a real Markdown parser).

### UI component registry (`ui-block.component` + `ui-block/components/`)
`UiBlockComponent` used to be one file with a 16-way `*ngSwitch` and every type's helper logic (chart geometry, weather icon mapping, ...) in one class. It's now a thin dynamic-component registry: `UI_COMPONENT_REGISTRY: Record<UIComponentType, Type<object>>` maps each approved type to its own standalone component under `ui-block/components/` (`weather-card`, `stock-card`, `stock-chart`, `table-block`, `chart-block`, `code-block`, `markdown-block`, `confirmation-card`, ...), rendered via `NgComponentOutlet` with `[ngComponentOutletInputs]`. `ConfirmationCardComponent`'s `actionSelected` output (only dynamic component with one) is wired back up imperatively via `ViewChildren('outlet')` + `ngAfterViewChecked`, since `NgComponentOutlet` only binds inputs declaratively. `UiBlockComponent` itself still owns the `pending` (loading/error) block rendering described above, since a loading id by definition isn't in `components` yet.
- `table-block`: sticky header inside a bounded scroll container, numeric-column right-alignment (`table-csv.ts`'s `detectNumericColumns()`, reusing the existing `.tnum` utility), "Show N more rows" pagination (no virtualization lib — the schema caps tables at 200 rows), copy-as-TSV, and a real CSV export (hand-written RFC 4180 escaping in `table-csv.ts`, not a dependency).
- `chart-block`: still hand-written inline SVG (no charting library), now with real positioned tooltips (hover + tap + focus), a legend (skipped for pie, which already labels itself), visible axis labels/gridlines, an explicit empty-data state, an `aria-label` summary, and a per-chart-type value range (bar/area stay zero-based; line/scatter autoscale to local min/max — sharing one zero-based range across all types was flattening line-chart variation and would have exaggerated bar differences the other way).
- `code-block` (the standalone `CODE_BLOCK` UI type) **and** fenced code blocks inside any Markdown-rendered surface (`chat-window`'s main reply, the `MARKDOWN` UI type) share one highlighting/copy pipeline under `apps/chat-client/src/app/shared/markdown/`: `code-highlighter.ts` wraps `highlight.js/lib/core` with ~25 individually-registered languages (not the bundle-everything default export — adds ~33 kB gzipped), wired into `marked` via a custom `renderer.code` hook (`code-block-renderer.ts`). Copy/Wrap/line-number controls are injected as `<span role="button">` (not `<button>`/`data-*` — Angular's own `DomSanitizer`, which runs as a second, independent sanitizer after DOMPurify on every `[innerHTML]`-bound surface here, strips both from its allowlist) and handled by one delegated click listener (`code-block-interactions.ts`), since `[innerHTML]` content can't carry Angular `(click)` bindings. The Copy button always reads the exact original source text from an out-of-band, content-hashed `Map` (`code-snippet-store.ts`) — never re-extracted from the highlighted/line-split DOM, which would mangle whitespace.

### Typed action dispatch (`action-dispatcher.service.ts`)
Every `OrchestratorAction` a UI component or suggestion chip emits now routes through `ActionDispatcherService.dispatch()`/`dispatchLabel()` instead of two separate `chatService.sendMessage(...)` call sites. `action.type` (`OrchestratorAction.type`, narrowed to `'CONFIRM' | 'CANCEL' | (string & {})` — still accepts any string on the wire) drives it: no/unrecognized type falls back to resending `label` as a plain user message (today's behavior for weather/stock follow-ups and model-declared actions); `CONFIRM`/`CANCEL` sends a message built from the `CONFIRMATION_CARD`'s `confirmLabel`/`cancelLabel` and locks that card into a visible resolved state (a local `resolved` signal on `ConfirmationCardComponent` — not persisted; `CONFIRMATION_CARD` data isn't round-tripped through thread storage, so it re-renders unanswered on reload). **Read this precisely**: the backend never pauses mid-turn waiting for a confirmation — a `CONFIRMATION_CARD` is just another UI component in a reply, not a gate in front of an already-queued risky action. Confirming/cancelling tells the model what was decided for its *next* reply to react to; it does not stop, pause, or gate anything server-side. True gating would need a backend orchestration change (the LLM actually pausing mid-turn) that doesn't exist yet.

### Thinking panel (`research-panel.component`) — only shown when it has something real to say
`orchestration/research.ts`'s `researchNode` always emits at least one `research_status` event before deciding whether to skip (so a trace exists for literally every turn, including ones that never needed research) — persisting that unconditionally used to give every plain answer a permanent "Answered without research" panel. `chat.service.ts`'s exported `isResearchTraceWorthPersisting(trace)` now gates the pinning step: true when `trace.ran` (real findings came back) OR at least one planned query reached a settled `ok`/`failed` status (covers "every search failed" — real work happened, worth showing). Live behavior during an active turn is untouched. The panel's own internal "Sources" sub-list was also removed (redundant with `chat-window`'s canonical numbered Sources block below the message), and the separate `activityStatus()` progress line no longer renders alongside a live panel showing the identical underlying message — the panel is the single progress indicator once it exists.

### Modals
- `settings-modal.component`: Tabs (General, Diagnostics) — MCP/RAG/OmniRoute status. The old **Storage** tab was removed; GCS metrics are admin-facing operational data and now live in the admin console (`libs/frontend/admin-analytics`) behind `GET /api/v1/admin/storage`. The backend's `GET /api/chat/storage/metrics` route is deliberately left in place (still a valid authenticated endpoint; removing it would be an unrelated breaking change).
- `projects-modal.component`: Projects workspace — list / create / rename, custom-instructions textarea, per-project file upload + file list, delete, "Start chat in project"
- `session-expired-modal.component`: Re-authentication prompt
- `login-error-toast.component`: Sign-in failure toast

### Services
- `auth.service.ts`: Google OAuth2 flow, session storage, JWT decode, token management. `logout()` existed from early on but had no UI control wired to it until the navbar avatar became a dropdown (name/email + Sign out) — there was genuinely no way to sign out of this app before that.
- `chat.service.ts`: Thread CRUD, SSE stream consumption, model selection, MCP toggle. Sends `threadId` + `projectId` with every stream request; `createNewThread(projectId?)` scopes a conversation to a project; `activeProjectId` computed.
- `project.service.ts`: `/api/v1/projects` client — signals `projects`, `selectedProject(Id)`, `selectedProjectFiles`, `isLoading`, `isUploadingFile`, `error`. Reloads on login, clears on logout.

### Where the Projects UI lives
- Sidebar: a "Projects" section above thread history (click a project = new chat scoped to it; `+` opens the modal). Threads show their project name as a sub-label.
- Message input: a project badge in the composer's top row when the conversation is scoped.

## Admin Analytics Frontend (`libs/frontend/admin-analytics/`)
A plain Nx Angular library **consumed directly into chat-client's own build** (`@chat-monorepo/admin-analytics`, same mechanism `libs/shared` already uses) — not a separate app, not a separate deployment, not Module Federation (rejected as too risky on this Angular version's esbuild builder). One build, one Cloud Run service, same footprint as before this feature existed. This replaced an earlier `apps/admin-analytics` standalone-app version within the same session — see git history if the old shape matters.
- **No login of its own** — opening the console reuses whatever chat-client session is already active. The lib doesn't depend on chat-client's concrete `AuthService` directly though (that would violate Nx's lib-can't-import-app boundary and make the lib untestable standalone) — it depends on a small `ADMIN_AUTH_BRIDGE`/`ADMIN_API_BASE_URL` injection-token interface (`auth-bridge.token.ts`) that chat-client provides in `app.config.ts` using its own `AuthService`.
- **Entry point**: a navbar icon, visible only when `authService.userSignal()?.role === 'admin'` (display/UX only — the real boundary is still `requireAdmin` re-checking Firestore server-side on every request). Clicking it sets a boolean in `AppComponent` that renders `<lib-admin-dashboard>` as a full-screen overlay **in place** — no navigation, no new tab, no route.
- **Access-denied is an inline state**, not a page: `AdminApiService.accessDenied` flips true on any 403 from an admin call, and the dashboard template swaps to a "not authorized" block in place — the lib doesn't own routing at all, so it can't own a dedicated access-denied route either.
- **Two views, not one page.** `admin-dashboard.component` is a thin shell: header (brand, one 7/30/90-day filter, close) + a tab strip switching between two child views. The switch is **a signal, not a Router** — this lib owns no routing (architecture.md §5); it's rendered as an overlay inside chat-client's shell, so a real route would fight the host app's navigation. Data is fetched once in the shell and passed to both views, so switching costs no requests; only a date change or a role change refetches.
  - `views/overview-view` — the system-wide pulse: one hero figure (estimated cost) + stat tiles with sparklines, the time-series chart, per-model breakdown, storage panel.
  - `views/users-view` — everything about people: a summary strip, search + role filter, and `components/user-table`, which **joins the registry to the usage aggregate one row per account** — consumption, role badge, promote/demote, and the session-level drill-down all in the same row. (This replaced two separate panels a long scroll apart, `user-usage-table` + `user-management`, which forced an operator to match names across two lists by eye.) `buildUserRows` handles both directions of the mismatch: a registered user with no traffic still appears, and usage from a uid with no registry doc is marked "not in the user registry" rather than rendered as a broken row.
- All five backend calls load via `Promise.allSettled`, so one failing panel degrades that panel only.
- **Charts are hand-written inline SVG** — no charting library is installed and none was added. Design follows the `dataviz` skill: one series at a time (never a dual axis), a re-stepped `accentCyan` (`#0891b2`) validated against this app's glass surface (`#0d1320`) for the OKLCH lightness band / chroma floor / CVD separation / ≥3:1 contrast; **monotone cubic** interpolation (Fritsch–Carlson — the one smoothing family that can't overshoot, so it never draws a dip or peak that isn't in the data); full-height per-day hover bands driving a crosshair (the hit target is the column, not the 2px line) + keyboard arrow-key navigation; exactly one direct label (the window's peak); and a table-view twin so the tooltip never gates a value. `components/sparkline` is the stat-tile trend slot — shape only, `aria-hidden`, accent on the hero tile and a de-emphasis grey elsewhere.
- ⚠️ **`chat-client/tailwind.config.js`'s content globs must stay ABSOLUTE.** They used to be relative, which Tailwind resolved against the *process* CWD (the Nx workspace root) rather than against the config file — so `../../libs/frontend/admin-analytics/src/**` pointed two levels above the workspace root at nothing, and **the admin lib was never scanned**. Every class it used that chat-client didn't also use (`grid-cols-12`, `col-span-*`, `ambient-glow-1`, every arbitrary value) was silently dropped from the bundle, which is most of why the console looked unstyled. The globs are now built from `__dirname` with forward slashes (fast-glob treats `\` as an escape). Sanity check after touching them: `grep '\.ambient-glow-1{' dist/apps/chat-client/browser/styles-*.css`.
- `apps/chat-client/src/styles.css` carries the console's shared surfaces (`.panel`, `.panel-hover`, `.well`) plus `.tnum` — the last of which the admin console referenced for months before it was defined anywhere, so every "tabular" column was rendering with proportional figures.

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
| GET | /api/chat/usage | Bearer | Current user's recent usage/cost records (see Usage & Cost Tracking) |
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
| GET | /api/v1/admin/users | Bearer + **admin** | All registered users with their role |
| PATCH | /api/v1/admin/users/:uid/role | Bearer + **admin** | Set a user's role; refuses to demote the last admin |
| GET | /api/v1/admin/usage/summary?days= | Bearer + **admin** | KPI totals + dense daily series |
| GET | /api/v1/admin/usage/by-user?days= | Bearer + **admin** | Per-user tokens/cost/last activity |
| GET | /api/v1/admin/usage/by-model?days= | Bearer + **admin** | Per-model requests/tokens/cost |
| GET | /api/v1/admin/usage/records?userId=&limit=&days= | Bearer + **admin** | Raw session-level usage records |
| GET | /api/v1/admin/storage | Bearer + **admin** | GCS bucket size/cost (moved off chat-client's Settings modal) |

> CORS `methods` in `main.ts` must include PUT/PATCH/DELETE — the thread-save and project CRUD routes preflight-fail in production without them.

## Shared Types (`libs/shared/src/interfaces/chat.interface.ts`)
- AIModelType: gemini-1.5-pro | gemini-1.5-flash | gemini-pro-latest | gemini-flash-latest | gpt-4o | gpt-4o-mini | omniroute-default
- ChatMessage, ChatThread, ChatStreamRequest, UserSession, AIProviderResponse
- StorageMetricsResponse, ImageGenerationRequest/Response, SystemDiagnostics
- **Project, ProjectFile, ProjectListResponse, ProjectFileListResponse, MemoryEntry, MemoryKind**
- `ChatThread` gained `projectId`, `summary`, `summarizedThroughIndex`, `summaryUpdatedAt` (server-written summary fields round-trip through the client's `PUT /api/chat/threads`; that save is `merge:true` so an older client can't wipe them).
- `ChatStreamRequest` gained `threadId` and `projectId`.
- `UserSession` gained an optional `role` (`'user' | 'admin'`), populated by `POST /api/auth/session`'s response at login — **display/UX only** (drives whether the admin nav icon shows), never the authorization boundary.

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
| Code syntax highlighting | ✅ real, via `highlight.js` (~25 languages), shared across the standalone `CODE_BLOCK` UI type and every Markdown-rendered surface — copy/wrap/line-number controls, not just colored text |
| Structured UI components (weather/stock/table/chart/...) | ✅ 16 approved types via a dynamic component registry (`ui-block/components/`); weather/stock stream progressively (loading → data) from the tool call itself, everything else via the model's trailing fenced block |
| Typed UI action dispatch | ✅ `ActionDispatcherService`; `CONFIRM`/`CANCEL` resolve a `CONFIRMATION_CARD` visually but do not gate any backend action (see Structured UI section above) |
| Edit last user message | ✅ last-message-only (see Edit message section above) |
| Model selector dropdown | ✅ |
| Follow-up suggestions | ✅ |
| Copy message to clipboard | ✅ |
| User profile identity | ✅ |
| Chat thread history | ✅ (client-side search over already-loaded titles; no backend search endpoint) |
| Image generation | ✅ real, via OpenRouter `google/gemini-2.5-flash-image` + GCS (or inline data URI if GCS unconfigured) |
| Tool/function calling (MCP) | ⚠️ real function calling; code_interpreter runs real sandboxed JS/TS (isolate-level, not OS-level isolation) via `isolated-vm`; web_search still has no backing provider |
| RAG context injection | ✅ real similarity search + hybrid rerank, user- and project-scoped; fed by both upload routes |
| Projects (instructions + files) | ✅ CRUD + scoped ingest + context injection + UI |
| Long-term memory | ✅ gated extraction, Firestore-backed, injected via Prompt Manager |
| Conversation summarization | ✅ threshold-triggered rolling summary, persisted on the thread doc |
| Prompt management | ✅ versioned registry; all prompt text centralised |
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
npx vitest run --config vite.config.ts  # chat-api unit tests (from repo root)
npx nx test chat-client                 # chat-client unit tests
```
`chat-client` had no test target or spec files at all until a vitest setup was added (`apps/chat-client/vite.config.mts`, `tsconfig.spec.json`, `src/test-setup.ts`, registered in the root `vitest.config.ts` projects array) — same `@analogjs/vite-plugin-angular` pattern `libs/frontend/admin-analytics` already used. It now has real coverage for the SSE frame parser, the action dispatcher, table CSV/TSV logic, chart geometry, and the code-highlighting/copy pipeline.

## Infrastructure
No IaC (Terraform was scaffolded once, never applied, and removed to avoid maintaining unused code).
Infrastructure is created/managed directly via `gcloud` commands in `.github/workflows/ci-cd.yml` and
`cloudbuild.yaml` (region `asia-south1`, Artifact Registry repo `chat-repo`, Firestore DB `nexus-ai`,
bucket `nexusai-generated-images` in prod).

### Building from a git worktree (gotcha)
If `node_modules` in a worktree is a junction/symlink to the main checkout, Nx resolves its workspace root through the symlink's real path and **silently builds the main checkout's source instead of the worktree's**. Set `NX_WORKSPACE_ROOT_PATH=<absolute path to the worktree>` for the build to actually compile your changes. Sanity check: `dist/` should appear inside the worktree, not the main checkout.

## Known gaps / limitations
- The personal RAG knowledge base is still in-process only — it resets on restart and is not shared across Cloud Run instances. Project files are the exception (rehydrated from Firestore).
- On the legacy fallback path (`AIRouterService`, used when the LangGraph call fails before any token is written), the assembled context is NOT re-applied — that turn loses project instructions/memories/summary, and usage is not logged.
- Memory extraction only reads the latest **user** message; facts stated by the assistant are never stored.
- `summarizedThroughIndex` indexes into the message array the client sends. Edit-message and Regenerate both exist now, but are deliberately restricted to only the LAST user/assistant message for exactly this reason — editing or regenerating an earlier turn would shift/invalidate the index. Supporting that would need this revisited (and likely a real branching model, not just an index fix).
- `GET /api/chat/usage` needs a Firestore composite index (`userId` ASC + `timestamp` DESC on the `usage` collection) that isn't provisioned anywhere — Firestore will prompt with a console link to create it on first real use. The admin API deliberately avoids that shape (timestamp-only query + in-process filtering), so it needs no index.
- Admin analytics aggregates read the whole date-filtered `usage` set into memory (capped at 20k docs). Fine at current volume, not a design that scales — see the BigQuery note in the Admin Analytics section.
- No thumbs-up/down feedback on assistant messages yet — no backend endpoint or storage for it.
- Citations are a flat, unlabeled chip list below the answer (`msg.sources`) — no inline `[1]`/`[2]`-style markers tying a specific claim in the prose to the source that backs it.
- `ToolResultLeakStreamFilter` (see Structured UI section above) is a narrow, best-effort backstop, not a guarantee — it only catches a raw JSON leak carrying 2+ of a curated weather/stock field-name list, and its fenced-code-block exemption is a heuristic toggle, not real Markdown parsing.
- Thread rename/delete has no backend support (no endpoints in `chat.routes.ts`) — the sidebar has a client-side search filter over already-loaded titles, but no way to rename or delete a saved thread.
