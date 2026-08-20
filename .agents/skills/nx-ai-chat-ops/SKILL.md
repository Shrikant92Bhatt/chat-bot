---
name: nx-ai-chat-ops
description: Market-standard operational runbook and skill for developing, building, containerizing, and deploying the enterprise Nx Monorepo AI Chat application.
---

# Nx Monorepo AI Chat Ops Skill

This skill provides step-by-step procedures for managing, testing, containerizing, and deploying the enterprise AI Chat application.

---

## 🛠 1. Monorepo Build & Development Commands

### Run Both Apps Concurrently (Parallel Mode)
```bash
npm start
```
Starts:
- `chat-api` backend on `http://localhost:3000`
- `chat-client` frontend on `http://localhost:4200`

### Build All Projects
```bash
npx nx run-many -t build
```
Compiles `libs/shared`, `apps/chat-api`, and `apps/chat-client`. `libs/frontend/admin-analytics`
(the admin console) is NOT built separately — it's a library consumed directly into chat-client's
own build, the same mechanism `libs/shared` uses. There is no `apps/admin-analytics` — an earlier
version of this feature was a separate deployable app; it was folded into chat-client and removed.
If you see a reference to `apps/admin-analytics` anywhere, it's stale.

### Verifying a build actually compiled YOUR changes (gotcha)
If you're working in a git worktree (e.g. a background agent), `node_modules` there may be a
junction/symlink to the main checkout. Nx then resolves the workspace root through that symlink's
real path and can **silently build the main checkout's source instead of the worktree's** — a green
build can prove nothing about your actual changes. Run a real `npm install` in the worktree rather
than trust the junction, and confirm `dist/` lands *inside the worktree*, not the main checkout,
before trusting the result.

---

## 🐳 2. Production Containerization Runbook

### Build Express Backend Container
```bash
docker build -t chat-api:latest -f Dockerfile.api .
```

### Build Angular NGINX Frontend Container
```bash
docker build -t chat-client:latest -f Dockerfile.client .
```

There is no `Dockerfile.admin` — the admin console ships inside the chat-client image (see above).

---

## ☁️ 3. GCP Deployment Runbook

### Submit Build to GCP Cloud Build & Cloud Run
```bash
gcloud builds submit --config=cloudbuild.yaml
```

Two Cloud Run services total (`chat-api`, `chat-client`), deployed via the raw `gcloud run deploy`
commands already in `.github/workflows/ci-cd.yml`, which runs automatically on every push to `main`.
There is no Terraform/IaC layer — one was scaffolded once, never applied, and removed rather than
kept in sync for no functional benefit. `gcloud` in CI is the real, only deployment path.

**Branch discipline**: never push directly to `main`. Branch off `main`, push the branch, open a PR.
`main` is branch-protected against force-push/deletion, but a direct push from an authorized account
is NOT blocked by that alone and will still trigger a real production deploy the moment its checks
pass — the PR step is a discipline choice this repo relies on, not something enforced for you.

### Getting the first admin account
Roles don't exist until someone has one. One-time bootstrap:
```bash
npx nx build chat-api
node dist/apps/chat-api/apps/chat-api/src/scripts/migrate-add-user-roles.js
```
Edit `INITIAL_ADMIN_EMAILS` in `apps/chat-api/src/scripts/migrate-add-user-roles.ts` first. Safe to
re-run (idempotent — never overwrites a role that's already set). Every promotion after the first
goes through the admin console itself (Admin console → user management), not this script again.

---

## 🔒 4. Environment Variables Checklist
Full reference with inline explanations and defaults: [`.env.example`](../../../.env.example) — copy
it to `.env.local` (gitignored, takes precedence over `.env`). At minimum, `.env.local` needs:
- `GEMINI_API_KEY` — chat responses, memory extraction, summarization.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google Sign-In.
- `GOOGLE_APPLICATION_CREDENTIALS` or `FIREBASE_SERVICE_ACCOUNT_KEY` — Firestore access (threads,
  projects, memory, usage, rate limits, user roles — one database backs all of it).
- `APP_SESSION_SECRET` — required in production (a random one is generated per-process if unset,
  which invalidates every session on each restart/deploy — fine for local dev only).

Optional, all with working defaults if unset: `OPENAI_API_KEY`; `OPENROUTER_API_KEY` /
`OPENROUTER_BASE_URL` (multi-provider routing, the real `web_search` tool, image generation);
`OMNIROUTE_BASE_URL` / `OMNIROUTE_API_KEY` (self-hosted gateway fallback); `GCS_BUCKET_NAME` (image/
file storage — degrades to inline data URIs without it, doesn't fail); `CODE_SANDBOX_TIMEOUT_MS` /
`CODE_SANDBOX_MEMORY_MB`; `ANON_TRIAL_MESSAGE_LIMIT` / `AUTH_DAILY_MESSAGE_LIMIT` /
`RATE_LIMIT_WINDOW_HOURS`; `ALLOWED_ORIGIN` (comma-separated, defaults to `*` locally).
