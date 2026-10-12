# Migrating off GCP Cloud Run to Vercel

> **If your live Firestore database (nexusai-gcp.duckdns.org) has real users/threads you care about, stop and say so before cutting over.** This change points the app at a brand-new, empty Postgres database — nothing is copied over automatically. No Firestore→Postgres data-export script exists here. If that data matters, the move is: export it from Firestore, write an import into the `users`/`threads`/`memories`/... tables below, then run it against the new database before anyone signs in for real. If it's fine to start fresh (e.g. this was still pre-launch), there's nothing else to do here.

## What changed in this repo

- `chat-client` (Angular) and `chat-api` (Express) now deploy together as **one Vercel project**:
  - `chat-client` builds to static files (`vercel.json` → `buildCommand`/`outputDirectory`).
  - `chat-api` runs as a Vercel serverless function at [`api/index.ts`](api/index.ts), which just imports the Express app from `apps/chat-api/src/app.ts`.
  - Because both are served from the same origin, the client now calls the API with relative paths (`/api/...`) instead of a hardcoded Cloud Run URL — no CORS needed. See `apps/chat-client/src/app/core/runtime-config.ts` and `scripts/generate-vercel-env.js`.
- The `code_interpreter` tool's sandbox (`isolated-vm`) **cannot run inside a Vercel serverless function** (it's a native V8-isolate addon). It's been split into its own standalone microservice, [`infra/sandbox-service`](infra/sandbox-service), which still needs a container host. `apps/chat-api/src/tools/code-sandbox.ts` now calls it over HTTP.
- **Firestore is gone, replaced by Postgres.** This was the other real blocker to a clean Vercel deploy: Cloud Run's Firestore access was automatic (Application Default Credentials via the service's own identity), which Vercel has no equivalent for — every deploy would have needed a manually-generated GCP service-account key just to reach the database. A real Postgres connection string doesn't have that problem. See [`apps/chat-api/src/db/postgres.ts`](apps/chat-api/src/db/postgres.ts) and [`db/migrations/001_init.sql`](apps/chat-api/src/db/migrations/001_init.sql) for the schema (threads, users, projects, memories, usage, rate limits, settings, and the RAG vector store via `pgvector`).
- GCS (generated images) is **unchanged** and **still has the same ADC problem Firestore had** — see "Known remaining gap" below. It wasn't in scope for this pass.
- `.github/workflows/ci-cd.yml` no longer builds/deploys Docker images for chat-api/chat-client — Vercel's own GitHub integration does that. CI now only builds/deploys `infra/sandbox-service` when it changes. It does run chat-api's test suite now, against a `pgvector/pgvector:pg16` service container.
- Removed (now unused): `Dockerfile`, `Dockerfile.api`, `Dockerfile.client`, `nginx.conf`, `docker-entrypoint.sh`, `cloudbuild.yaml`, `cloudbuild-api.yaml`, `cloudbuild-client.yaml`, `db/firestore.ts`, the `firebase`/`firebase-admin` packages.

## Scope of this migration

The **compute/hosting** layer (Cloud Run + Cloud Build + the load balancer) and **the database** (Firestore → Postgres) both moved. Cloud Storage (generated images) stays on GCP for now — it's usage-based and cheap, and swapping it (to Vercel Blob or similar) is a separate, smaller follow-up if you want it. See "Known remaining gap" below for exactly what that means in practice.

### Known remaining gap: GCS still needs a GCP credential

`apps/chat-api/src/storage/uploader.ts` (`GcsUploader`) authenticates to Google Cloud Storage the exact same way `db/firestore.ts` used to authenticate to Firestore: via Application Default Credentials, with zero explicit config. That worked for free on Cloud Run (the service's own identity) and does **not** work on Vercel (no equivalent ambient identity). Two honest options, pick one:

1. **Leave `GCS_BUCKET_NAME` unset on Vercel.** `GcsUploader` already degrades gracefully when unconfigured — generated images return a mock/inline URL instead of a real upload, rather than crashing. This is the zero-effort option; you just don't get persisted generated images.
2. **Wire up GCS credentials properly** (new work, not done here): generate a GCP service-account key the same way the old `FIREBASE_SERVICE_ACCOUNT_KEY` step would have, and update `GcsUploader`'s constructor to accept `credentials: JSON.parse(process.env.GCS_SERVICE_ACCOUNT_KEY)` instead of the bare `new Storage()` ADC call. Or, bigger but cleaner: replace GCS with Vercel Blob (`mcp__Vercel__create_storage_stores_blob` / the Vercel dashboard's Storage tab) the same way Firestore was replaced with Postgres.

Don't set `GCS_BUCKET_NAME` on Vercel without doing one of these — it'll otherwise fail ADC auth on every image-generation call.

---

## What you need to do

### 1. Create the Vercel project
1. In the Vercel dashboard, **Add New → Project**, import `Shrikant92Bhatt/chat-bot` from GitHub.
2. Framework Preset: **Other**. Leave Root Directory as the repo root — `vercel.json` already sets the build command (`npm run build:vercel`) and output directory (`dist/apps/chat-client/browser`); you shouldn't need to override anything in the dashboard.
3. Project Settings → General → Node.js Version: set to **20.x or later** (the repo targets Node 24 elsewhere, but any current Vercel-supported version works fine here since the sandbox's native dependency no longer lives in this project).

### 2. Set environment variables (Project Settings → Environment Variables, for Production at minimum)

| Variable | Value / how to get it |
|---|---|
| `GEMINI_API_KEY` | Same value as today (GCP Secret Manager → `GEMINI_API_KEY`, or generate a new one at aistudio.google.com/apikey) |
| `GOOGLE_CLIENT_ID` | `953232172604-iukeghd5021k56htjq7ep332bvtvppot.apps.googleusercontent.com` (same as today — public, not a secret) |
| `GOOGLE_CLIENT_SECRET` | Same value as today (GCP Secret Manager → `GOOGLE_CLIENT_SECRET`) |
| `APP_SESSION_SECRET` | Same value as today (GCP Secret Manager → `APP_SESSION_SECRET`) — reusing it keeps existing sessions valid |
| `OPENROUTER_API_KEY` | Same value as today (GCP Secret Manager → `OPENROUTER_API_KEY`) |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` |
| `DATABASE_URL` | **New requirement** — see step 3 below |
| `GCS_BUCKET_NAME` | Leave **unset** unless you've done the GCS credential work described above — see "Known remaining gap" |
| `CODE_SANDBOX_SERVICE_URL` | The sandbox-service URL from step 4 below |
| `CODE_SANDBOX_SERVICE_SECRET` | A secret you generate — see step 4 below |

`ALLOWED_ORIGIN`, `API_URL`, `FIRESTORE_DATABASE_ID`, `FIREBASE_SERVICE_ACCOUNT_KEY`, and `GOOGLE_APPLICATION_CREDENTIALS` are no longer needed (client/API are same-origin now, and Firestore is gone).

### 3. Provision a Postgres database and run migrations

This is the step that replaces the old "generate a GCP service-account key" requirement — much less setup.

1. **Create the database.** Easiest: Vercel dashboard → your project → **Storage** tab → **Create Database** → Postgres (this is Neon under the hood) → it auto-injects a `DATABASE_URL` (and a few `POSTGRES_*` aliases) into your Vercel project's env vars for you. Alternatively, create one directly at [neon.tech](https://neon.tech) (free tier is enough to start) and paste its connection string into `DATABASE_URL` yourself. Either way, use the **pooled** connection string (hostname ends in `-pooler`) for Vercel — see `db/postgres.ts`'s doc comment for why.
2. **Enable pgvector** (needed for the RAG knowledge-base store) — Neon has it built in; `CREATE EXTENSION IF NOT EXISTS vector;` is already the first line of the migration below, so this is automatic as long as the extension is available on your instance (it is, on Neon, by default).
3. **Run the schema migration once** against that database:
   ```bash
   DATABASE_URL="<your-pooled-connection-string>" npm run migrate:db
   ```
   This creates every table (`threads`, `users`, `projects`, `memories`, `usage`, `rate_limits`, `settings`, `message_feedback`, `rag_documents`) and is idempotent — safe to re-run, and it tracks what's already applied in its own `_migrations` table.
4. **Bootstrap your first admin account**, once you've signed in to the app at least once with your Google account (this creates your `users` row):
   ```bash
   DATABASE_URL="<your-pooled-connection-string>" npm run bootstrap:admin
   ```
   This promotes the email hardcoded in `apps/chat-api/src/scripts/migrate-add-user-roles.ts`'s `INITIAL_ADMIN_EMAILS` — edit that list first if it's not already your email.

### 4. Deploy the sandbox microservice

This is the one piece still on a container host (isolated-vm can't run on Vercel):

1. Generate a shared secret: `openssl rand -hex 32`.
2. Add it to GCP Secret Manager as `CODE_SANDBOX_SERVICE_SECRET` (the CI workflow already expects a secret by that name, using your existing `GCP_SA_KEY` GitHub Actions credential).
3. Trigger the deploy — either push a no-op change under `infra/sandbox-service/` to let `.github/workflows/ci-cd.yml`'s `deploy-sandbox-service` job run, or do it manually once:
   ```bash
   gcloud builds submit --config=cloudbuild-sandbox.yaml
   gcloud run deploy sandbox-service \
     --image=asia-south1-docker.pkg.dev/<project>/chat-repo/sandbox-service:latest \
     --region=asia-south1 --platform=managed --allow-unauthenticated \
     --memory=512Mi --cpu=1 --concurrency=10 --min-instances=0 --max-instances=5 --timeout=30 \
     --set-secrets="CODE_SANDBOX_SERVICE_SECRET=CODE_SANDBOX_SERVICE_SECRET:latest"
   ```
4. Copy the deployed service's URL into Vercel's `CODE_SANDBOX_SERVICE_URL`, and the same secret value into Vercel's `CODE_SANDBOX_SERVICE_SECRET`.

`--min-instances=0` means it scales to zero and costs ~nothing when nobody's running code — this should be a small fraction of what the two full-time Cloud Run services cost today.

### 5. Update Google OAuth allowed origins

Google Cloud Console → APIs & Services → Credentials → your OAuth client → add your new Vercel URL(s) (e.g. `https://<project>.vercel.app`, and your custom domain once attached) to **Authorized JavaScript origins**. Otherwise Google Sign-In will fail on the new domain.

### 6. Test before cutting over

Once the first deploy succeeds:
- `https://<project>.vercel.app/health` should return `{"status":"ok",...}`.
- Sign in with Google (creates your `users` row), send a chat message (exercises Postgres threads/usage), try the code-interpreter tool (exercises the sandbox-service).
- Check Vercel's function logs for errors or timeouts. Chat responses can run long; `vercel.json` currently requests `maxDuration: 60` for the API function — raise it if your Vercel plan allows more and long generations are getting cut off.
- Remember the callout at the top of this doc: nothing is migrated from Firestore automatically. Confirm that's acceptable before pointing real users at this.

### 7. Point your domain at Vercel, then decommission the old GCP services

Only after step 6 passes:
1. Vercel → Project → Domains → add your custom domain (or keep using the free `*.vercel.app` one), update DNS as Vercel instructs.
2. Delete the old Cloud Run services — this is what actually stops the Cloud Run billing: `gcloud run services delete chat-api --region=asia-south1` and `gcloud run services delete chat-client --region=asia-south1`.
3. Delete the external HTTPS load balancer + static IP + forwarding rules that fronted them (mentioned in the old README) — this fixed monthly cost often exceeds Cloud Run's own usage-based cost, and it has no equivalent needed on Vercel (custom domains + HTTPS are included).
4. Optionally clean up the old `chat-api`/`chat-client` images in Artifact Registry to stop storage charges (the `sandbox-service` image stays, in the same `chat-repo` repository).

I can't perform any of steps 1–7 myself — I don't have access to your Vercel account or GCP console from here. Everything in this repo is ready for you to point at once you've done the account-side setup above.
