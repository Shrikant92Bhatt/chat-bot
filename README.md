# NexusAI — Enterprise Multi-LLM Chat Monorepo

[![CI/CD Pipeline](https://github.com/Shrikant92Bhatt/chat-bot/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/Shrikant92Bhatt/chat-bot/actions/workflows/ci-cd.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Open Issues](https://img.shields.io/github/issues/Shrikant92Bhatt/chat-bot)](https://github.com/Shrikant92Bhatt/chat-bot/issues)
[![Open PRs](https://img.shields.io/github/issues-pr/Shrikant92Bhatt/chat-bot)](https://github.com/Shrikant92Bhatt/chat-bot/pulls)
[![Last Commit](https://img.shields.io/github/last-commit/Shrikant92Bhatt/chat-bot)](https://github.com/Shrikant92Bhatt/chat-bot/commits/main)

An Nx monorepo AI chat application: an Angular 18 standalone-component frontend with a glassmorphism UI, and an Express backend that streams responses from Google Gemini and OpenAI over Server-Sent Events. Deployed on Google Cloud Run behind an HTTPS load balancer, with Google Sign-In for auth and a fully automated GitHub Actions CI/CD pipeline.

**Live:** https://nexusai-gcp.duckdns.org

---

## Repository Structure

```
.
├── apps/
│   ├── chat-client/                     # Angular 18 standalone + Tailwind
│   │   └── src/app/
│   │       ├── components/              # navbar, sidebar, chat-window, message-input
│   │       │   └── */*.component.html   # each component's template is its own file
│   │       ├── core/runtime-config.ts   # reads the deployed API URL at runtime (assets/env.js)
│   │       └── services/                # AuthService (Google Identity), ChatService (SSE)
│   └── chat-api/                        # Express backend
│       └── src/
│           ├── env.ts                   # loads .env/.env.local before anything else
│           ├── middleware/              # Google ID token verification + anon free-trial gate
│           ├── services/                # Gemini/OpenAI stream routing, anon usage tracking
│           ├── adapters/                # MCP, RAG, Vector DB extension stubs
│           └── main.ts
├── libs/shared/                         # Shared TS types/DTOs (@chat-monorepo/shared)
├── Dockerfile.api / Dockerfile.client    # Multi-stage production images
├── docker-entrypoint.sh                 # Writes the API URL into chat-client at container start
├── cloudbuild.yaml                      # Builds & pushes both images to Artifact Registry
├── .github/workflows/ci-cd.yml          # Build, verify, and auto-deploy pipeline
└── nx.json / tsconfig.base.json / package.json
```

---

## Key Features

- **Multi-LLM SSE streaming** — Gemini 1.5 Pro/Flash and GPT-4o/GPT-4o-mini, routed and streamed to the client in real time.
- **Google Sign-In** — Google Identity Services on the frontend; ID tokens verified server-side against Google's public keys (`google-auth-library`).
- **Free trial without sign-in** — one anonymous message is allowed per IP, enforced server-side (survives page reload or cleared browser storage), before sign-in is required.
- **Runtime-configurable deployment** — the frontend image doesn't hardcode a backend URL; it's injected at container startup, so the same image works across environments without rebuilding.
- **GCP-ready** — multi-stage Docker images, Cloud Run deployment, a custom domain behind an HTTPS load balancer with path-based routing (`/api/*` → backend, everything else → frontend).
- **Automated CI/CD** — every push runs a full build + Docker verification; merges to `main` auto-deploy both services to Cloud Run.
- **Extension points** — stubbed adapters for MCP (Model Context Protocol), RAG, and vector DBs.

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
| Variable | Required for |
|---|---|
| `GEMINI_API_KEY` | Gemini responses — get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `OPENAI_API_KEY` | GPT-4o responses |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Sign-In — from [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) |
| `ALLOWED_ORIGIN` | CORS in production; defaults to `*` locally |

`.env.local` is gitignored and takes precedence over `.env` — this is where real local secrets belong.

### 3. Run
```bash
npm start
```
Runs both apps in parallel via Nx (`nx run-many -t serve --parallel=2`):
- API: `http://localhost:3000`
- Client: `http://localhost:4200`

Without sign-in, one message per session works via the free-trial path; further messages prompt Google Sign-In.

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

[MIT](LICENSE)
