# Enterprise AI Chat Monorepo - Market Standard Guidelines

## Architecture Overview
This repository is an enterprise-grade **Nx Monorepo** containing:
- **`apps/chat-client`**: Angular Standalone Components + Signals, Tailwind CSS (Glassmorphism & Neumorphism UI).
- **`apps/chat-api`**: Node.js + Express TypeScript backend. A real LangGraph agent↔tools loop is the
  primary chat path (streaming via OpenRouter, or a local self-hosted gateway); direct Gemini/OpenAI
  SDK calls (`AIRouterService`) are the fallback only, reached if the gateway call fails before any
  token streams.
- **`libs/shared`**: Shared DTOs and interfaces (`@chat-monorepo/shared`).
- **`libs/frontend/admin-analytics`**: Admin-only usage/cost console — a library **consumed directly
  into `chat-client`'s own build**, not a separate app or deployment (see `architecture.md` §5). Gated
  end-to-end: a `role` field on Firestore, re-checked fresh on every admin request server-side, never
  trusted from the session token.

Real, implemented subsystems worth knowing exist before assuming they don't: **Projects** (custom
instructions + a scoped knowledge base), **RAG** (vector search + BM25/cosine hybrid reranking),
**long-term memory** (gated extraction), **conversation summarization**, a **Prompt Manager**
(versioned templates), real **tool calling** (calculator, sandboxed code execution via `isolated-vm`,
image generation, web search), Firestore-backed **rate limiting** and **usage/cost tracking**, and the
**admin console** above. See `architecture.md` for how they fit together, `.agents/PROJECT_CONTEXT.md`
for the file-by-file reference.

---

## Coding Standards & Rules

### 1. Frontend (Angular 18)
- **Standalone Components Only**: All components must be standalone (`standalone: true`).
- **Signals State Management**: Use `signal()`, `computed()`, and `writable()` for reactive state management.
- **Glassmorphism Styling**: Use frosted glass panels (`backdrop-blur-md bg-white/5 border border-white/10`), obsidian dark theme tokens, and `[ngClass]` for dynamic class bindings to prevent HTML parser errors.
- **SSE Stream Consumption**: Use standard `fetch` with `ReadableStream` for parsing `data:` chunks from the backend.

### 2. Backend (Node.js Express)
- **Google OAuth2 Middleware**: All protected endpoints under `/api/chat/*`, `/api/v1/projects/*`, and `/api/v1/admin/*` validate the app session token passed via `Authorization: Bearer` headers (`authenticateToken`). Admin routes additionally require `requireAdmin` (fresh Firestore role read, fails closed).
- **LLM Gateway, not a direct SDK dispatcher**: chat goes through a real LangGraph agent↔tools loop over an OpenRouter/OmniRoute gateway (`llm/client.ts`), not a simple Gemini-vs-OpenAI switch. `AIRouterService` (direct `@google/generative-ai`/`openai` SDK calls) is the legacy fallback, only reached if the gateway call fails before any token streams.
- **MCP, RAG, and the vector store are real, not stubs**: `mcp/tools.ts` has working tool implementations (calculator, sandboxed code execution, image generation, web search); `rag/` does real vector search with hybrid reranking; `rag/vector-db.ts` is a real (if in-process, non-persistent) similarity search. Don't treat any of these as scaffolding to fill in.
- **CORS**: `main.ts` must keep PUT/PATCH/DELETE in the allowed `methods` — project CRUD and thread saves preflight-fail without them once `ALLOWED_ORIGIN` is a real origin.

### 2a. Prompt & context rules (non-negotiable)
- **No inline prompt strings.** Every prompt the backend sends to an LLM is a versioned entry in `apps/chat-api/src/prompt/templates.ts`, keyed `<id>:<version>`. Changing wording means adding/editing a template, not typing a string into a node or service. Roll a change out by adding `:v2` and flipping the key at the call site.
- **One context-assembly path.** Anything that wants to add context to a chat turn (a new retriever, a new instruction source) extends `context/context-builder.ts` `buildContext()` and adds a template block in `prompt-manager.ts` `buildSystemPrompt()`. Do not prepend messages in `graph.ts`, in a route, or in the client.
- **Fail soft.** Every context source is gathered under `Promise.allSettled` and every Firestore/LLM side-call is try/caught. A missing key or an unreachable Firestore must degrade the answer, never break the turn. Never fabricate a value to fill a gap — return empty and log.
- **No silent truncation.** If summarization can't run, send the full history rather than dropping turns.
- **Never store every message.** Memory extraction goes through the `looksMemorable()` regex gate before any LLM call; only durable first-person facts/preferences/explicit "remember this" qualify.

### 2b. Firestore query rules
- Prefer **single-field** `where()` filters and sort/score in process (see `MemoryService`, `ProjectService`). Adding an `orderBy` to a filtered query silently requires a composite index that nobody has provisioned.
- Ownership is checked in the service layer on every read/write. A resource owned by another user must return 404, not 403 — don't make ids probeable.

### 2c. Admin/role rules (non-negotiable)
- **`role` is never a JWT claim.** The session token lives 7 days; baking a role into it would keep a demoted admin privileged for up to a week. `requireAdmin` re-reads `users/{uid}.role` from Firestore on every single admin request instead — this is the one place in the backend that fails **closed** (a Firestore error denies access), not soft like the context-assembly paths above.
- A client-side `role` check (e.g. showing/hiding the admin nav icon) is presentation only. Never add a client-only gate anywhere and call it done — the server-side re-check is the actual boundary, always.
- Any endpoint that changes a role must guard against demoting the last remaining admin (see `PATCH /api/v1/admin/users/:uid/role`'s `LastAdmin` rejection) — there being zero admins left is not a recoverable state without direct database access.

### 3. Build & DevOps Standard
- **Parallel Start**: Use `npm start` (`nx run-many -t serve --parallel=2`) for local dev.
- **Build Verification**: Run `npx nx run-many -t build` to ensure 100% compilation across all apps and shared libraries.
- **Worktree builds**: when `node_modules` is a junction/symlink into the main checkout, Nx resolves the workspace root through the real path and builds the *main checkout* instead — a green build then proves nothing about your changes. Pass `NX_WORKSPACE_ROOT_PATH=<worktree absolute path>` and confirm `dist/` lands inside the worktree.
- **Shared types**: `libs/shared` is imported by both apps. Change an interface there and rebuild both — a client-only or api-only build will not catch the drift.
- **Docker Containers**:
  - `Dockerfile.api`: `node:24-alpine` multi-stage production image for Express backend (the builder stage runs a plain `npm ci`, not `--omit=dev` — `typescript` needs to ship in the runtime image for the code-execution tool's TS transpilation, and `isolated-vm` needs its prebuilt native binary for `linux-x64-musl` present, not compiled at build time).
  - `Dockerfile.client`: Multi-stage build with NGINX (`nginx:alpine`) for Angular SPA static asset hosting and client-side routing fallback.

### 4. Git Branching & Workflow Rules
- **No Direct Push to `main`**: Never push changes directly to `main`.
- **Sensible Branch Naming**: Always use clear, descriptive, meaningful branch names reflecting the feature or fix (e.g., `feat/google-oauth-gcp-deploy`), rather than generic branch names.
- **Single Active Branch**: Consolidate ongoing updates on the active descriptive working branch.
- **PR Creation**: Only generate or present Pull Request links when explicitly requested by the user ("create pr").
