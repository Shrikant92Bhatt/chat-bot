# NexusAI — Enterprise Multi-LLM Chat Monorepo

[![CI/CD Pipeline](https://github.com/Shrikant92Bhatt/chat-bot/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/Shrikant92Bhatt/chat-bot/actions/workflows/ci-cd.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Open Issues](https://img.shields.io/github/issues/Shrikant92Bhatt/chat-bot)](https://github.com/Shrikant92Bhatt/chat-bot/issues)
[![Open PRs](https://img.shields.io/github/issues-pr/Shrikant92Bhatt/chat-bot)](https://github.com/Shrikant92Bhatt/chat-bot/pulls)
[![Last Commit](https://img.shields.io/github/last-commit/Shrikant92Bhatt/chat-bot)](https://github.com/Shrikant92Bhatt/chat-bot/commits/main)

An Nx monorepo AI chat application: an Angular standalone-component frontend with a glassmorphism UI, and an Express backend built around a real LangGraph agent loop — multi-LLM streaming (Gemini/GPT/Claude/Llama via OpenRouter), Projects with custom instructions and scoped knowledge bases, RAG with hybrid reranking, long-term user memory, conversation summarization, real tool calling (calculator, sandboxed code execution, image generation, web search), Firestore-backed rate limiting and usage/cost tracking, and a role-gated admin analytics console. Deployed on Google Cloud Run with Google Sign-In and a fully automated GitHub Actions CI/CD pipeline.

**Live:** https://nexusai-gcp.duckdns.org

For a deep dive into how the pieces fit together (diagrams of the context-assembly pipeline, RAG flow, code sandbox, rate limiting, and the admin console's authorization model), see **[architecture.md](architecture.md)**.

---

## Repository Structure

```
.
├── apps/
│   ├── chat-client/                     # Angular standalone + Tailwind
│   │   └── src/app/
│   │       ├── components/              # navbar, sidebar, chat-window, message-input,
│   │       │                            # settings/projects modals — each with its own template file
│   │       ├── core/runtime-config.ts   # reads the deployed API URL at runtime (assets/env.js)
│   │       └── services/                # AuthService (Google Identity), ChatService (SSE),
│   │                                    # ProjectService
│   └── chat-api/                        # Express backend
│       └── src/
│           ├── env.ts                   # loads .env/.env.local before anything else
│           ├── middleware/              # Google ID token verification, anon free-trial gate,
│           │                            # admin authorization (requireAdmin)
│           ├── orchestration/           # real LangGraph StateGraph (agent ↔ tools loop)
│           ├── context/                 # single context-assembly step (Projects + memory +
│           │                            # RAG + summarization, gathered in parallel, fail-soft)
│           ├── prompt/                  # versioned prompt template registry
│           ├── rag/                     # vector search + hybrid (BM25 + cosine) reranking
│           ├── memory/                  # gated long-term memory extraction
│           ├── summarization/           # rolling conversation summary
│           ├── projects/                # Projects CRUD + scoped knowledge base
│           ├── tools/                   # isolated-vm sandboxed code execution
│           ├── mcp/                     # tool definitions (calculator, code exec, image gen, web search)
│           ├── routes/                  # chat, auth, projects, admin
│           ├── services/                # rate limiting, usage/cost tracking, thread/user registry
│           ├── scripts/                 # one-time migrations (e.g. admin-role bootstrap)
│           └── main.ts
├── libs/
│   ├── shared/                          # Shared TS types/DTOs (@chat-monorepo/shared)
│   └── frontend/admin-analytics/        # Admin console UI — a library CONSUMED into
│                                        # chat-client's own build, not a separate app/deployment
├── Dockerfile.api / Dockerfile.client    # Multi-stage production images
├── docker-entrypoint.sh                 # Writes the API URL into chat-client at container start
├── cloudbuild.yaml                      # Builds & pushes both images to Artifact Registry
├── .github/workflows/ci-cd.yml          # Build, verify, and auto-deploy pipeline
└── nx.json / tsconfig.base.json / package.json
```

---

## Key Features

**Chat**
- Multi-LLM streaming via [OpenRouter](https://openrouter.ai) (Gemini, GPT, Claude, Llama, Grok through one key), falling back to a local/self-hosted OmniRoute gateway or direct Gemini/OpenAI SDKs if unconfigured.
- A real [LangGraph](https://langchain-ai.github.io/langgraphjs/) agent ↔ tools loop, not a single request/response call — the model can call tools, get results back, and continue.
- Markdown rendering, code syntax highlighting, follow-up suggestions, copy-to-clipboard.

**Context & memory**
- **Projects** — custom instructions plus a project-scoped knowledge base; conversations can be scoped to one.
- **RAG** — vector search over uploaded documents, reranked with a BM25 + cosine hybrid (Reciprocal Rank Fusion), scoped per-user and per-project.
- **Long-term memory** — gated extraction (a cheap regex pre-filter, then an LLM call) so it doesn't store every message; injected into future conversations.
- **Conversation summarization** — long threads get a rolling summary instead of an ever-growing prompt.

All four are gathered in parallel by a single context-assembly step (`apps/chat-api/src/context/context-builder.ts`) that fails soft — one broken piece degrades the answer, never breaks the turn. See [architecture.md](architecture.md) for the sequence diagram.

**Tools**
- Real calculator, sandboxed JS/TS code execution (`isolated-vm`, a real V8 isolate — not `eval`), image generation, and web search (via OpenRouter's `web` plugin).

**Platform**
- Google Sign-In, with one free anonymous message per IP before sign-in is required.
- **Role-based admin console** — a usage/cost analytics dashboard (per-user and per-model breakdowns, session-level drill-down, storage metrics, user role management) visible only to admin accounts. See [Admin Console](#admin-console) below.
- Firestore-backed rate limiting and usage/cost tracking — correct under Cloud Run's multi-instance concurrency, unlike a simple in-memory counter.
- Runtime-configurable deployment — the frontend image doesn't hardcode a backend URL; it's injected at container startup.
- Automated CI/CD — every push runs a full build + Docker verification; merges to `main` auto-deploy to Cloud Run.

---

## Getting Started

### 1. Install
```bash
npm install
```

### 2. Configure environment
Copy the example file and fill in real values:
```bash
cp .env.example .env.local
```
See [`.env.example`](.env.example) for the full list with inline explanations. At minimum you need:

| Variable | Required for |
|---|---|
| `GEMINI_API_KEY` | Chat responses, memory extraction, summarization — get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Sign-In — from [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) |
| `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_SERVICE_ACCOUNT_KEY` | Firestore access (threads, projects, memory, usage, roles) |

Everything else (OpenRouter, GCS, code sandbox limits, rate limit tuning) is optional with sensible defaults — the app degrades gracefully rather than failing when unset.

### 3. Run
```bash
npm start
```
Runs both apps in parallel via Nx (`nx run-many -t serve --parallel=2`):
- API: `http://localhost:3000`
- Client: `http://localhost:4200`

Without sign-in, one message per session works via the free-trial path; further messages prompt Google Sign-In.

---

## Admin Console

A usage/cost analytics dashboard — total tokens/cost, per-user and per-model breakdowns with session-level drill-down, storage metrics, and user role management — visible only to accounts with `role: 'admin'` on their `users` Firestore document. It's not a separate app: it's a library (`libs/frontend/admin-analytics`) built directly into chat-client, opened via a navbar icon that only appears for admins.

**Getting the first admin account:** roles don't exist until someone has one, so a one-time script bootstraps it:
```bash
npx nx build chat-api
node dist/apps/chat-api/apps/chat-api/src/scripts/migrate-add-user-roles.js
```
Edit the `INITIAL_ADMIN_EMAILS` allowlist at the top of [`apps/chat-api/src/scripts/migrate-add-user-roles.ts`](apps/chat-api/src/scripts/migrate-add-user-roles.ts) first. It's idempotent — safe to re-run, and it never overwrites a role that's already set. Once you have one admin, promote everyone else from the console itself (Admin console → user management) — no need to run the script again.

The role shown to the frontend is display-only (it decides whether to show the nav icon); the real authorization boundary is server-side — every admin API call re-reads the role fresh from Firestore, so a demotion takes effect on the very next request, not after a session expires.

---

## Deployment

Both services deploy to **Google Cloud Run**. See [`cloudbuild.yaml`](cloudbuild.yaml), [`Dockerfile.api`](Dockerfile.api), and [`Dockerfile.client`](Dockerfile.client) for the build definitions.

```bash
gcloud builds submit --config=cloudbuild.yaml
gcloud run deploy chat-api    --image=<region>-docker.pkg.dev/<project>/chat-repo/chat-api:latest    --region=<region>
gcloud run deploy chat-client --image=<region>-docker.pkg.dev/<project>/chat-repo/chat-client:latest --region=<region> \
  --set-env-vars="API_URL=<chat-api-url>"
```

The production deployment additionally sits behind an external HTTPS load balancer (static IP + managed SSL cert) so both services share one domain, with `/api/*` routed to the backend — this avoids CORS entirely and lets the custom domain use a plain DNS A record.

There's no Terraform/IaC layer — infrastructure is created and managed directly via the `gcloud` commands in `cloudbuild.yaml` and `.github/workflows/ci-cd.yml`. (One was scaffolded at one point; it was never applied and was removed rather than kept in sync for no functional benefit.)

---

## CI/CD

[`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml) runs on every push and pull request:

1. **Monorepo Build Check** — installs dependencies, builds all projects.
2. **GCP Docker Build Verification** — builds both production Docker images.
3. **Deploy to Cloud Run** — *main branch only* — builds, pushes, and deploys both services automatically.

`main` is branch-protected: **Monorepo Build Check** and **GCP Docker Build Verification** must pass before a PR can merge, and force-pushes/deletions are blocked.

### Contributing
1. Branch off `main`.
2. Open a PR — CI runs automatically.
3. Once both required checks pass, merge — production deploys automatically.

---

## License

MIT — see [LICENSE](LICENSE).
