# Migrating off GCP Cloud Run to Vercel

## What changed in this repo

- `chat-client` (Angular) and `chat-api` (Express) now deploy together as **one Vercel project**:
  - `chat-client` builds to static files (`vercel.json` → `buildCommand`/`outputDirectory`).
  - `chat-api` runs as a Vercel serverless function at [`api/index.ts`](api/index.ts), which just imports the Express app from `apps/chat-api/src/app.ts`.
  - Because both are served from the same origin, the client now calls the API with relative paths (`/api/...`) instead of a hardcoded Cloud Run URL — no CORS needed. See `apps/chat-client/src/app/core/runtime-config.ts` and `scripts/generate-vercel-env.js`.
- The `code_interpreter` tool's sandbox (`isolated-vm`) **cannot run inside a Vercel serverless function** (it's a native V8-isolate addon). It's been split into its own standalone microservice, [`infra/sandbox-service`](infra/sandbox-service), which still needs a container host. `apps/chat-api/src/tools/code-sandbox.ts` now calls it over HTTP.
- Firestore and GCS are **unchanged** — they're pay-per-use, not what was driving Cloud Run's bill, so this migration leaves them alone (see "Scope" below).
- `.github/workflows/ci-cd.yml` no longer builds/deploys Docker images for chat-api/chat-client — Vercel's own GitHub integration does that. CI now only builds/deploys `infra/sandbox-service` when it changes.
- Removed (now unused): `Dockerfile`, `Dockerfile.api`, `Dockerfile.client`, `nginx.conf`, `docker-entrypoint.sh`, `cloudbuild.yaml`, `cloudbuild-api.yaml`, `cloudbuild-client.yaml`.

## Scope of this migration

Only the **compute/hosting** layer moved (what Cloud Run + Cloud Build + the load balancer were actually billing for). Firestore (chat/user data) and Cloud Storage (generated images) stay on GCP — they're usage-based and cheap, and moving them would mean a real data migration, which wasn't part of what you asked for. If GCP costs are still too high after this migration, the next thing to check is Firestore/GCS usage itself, not hosting.

---

## What you need to do

### 1. Create the Vercel project
1. In the Vercel dashboard, **Add New → Project**, import `Shrikant92Bhatt/chat-bot` from GitHub.
2. Framework Preset: **Services**. Leave Root Directory as the repo root. `vercel.json` defines three services in one project: `web` (the Angular app, public at `/`), `api` (the Express app as a function, public at `/api/*`, `/.well-known/*` and `/health`) and `sandbox` (`infra/sandbox-service` as an internal container, reachable only from `api`). Build commands and output directories live on each service, so nothing needs overriding in the dashboard.
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
| `FIRESTORE_DATABASE_ID` | `nexus-ai` |
| `GCS_BUCKET_NAME` | `nexusai-generated-images` |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | **New requirement** — see step 3 below |
| `CODE_SANDBOX_SERVICE_URL` | **Don't set it.** Injected at runtime by the `api` service's binding to the `sandbox` service |
| `CODE_SANDBOX_SERVICE_SECRET` | Optional, `openssl rand -hex 32` |

`ALLOWED_ORIGIN` and `API_URL` are no longer needed (client and API are same-origin now).

#### 2b. Connectors (GitHub, Gmail, …) and the ChatGPT app

Without these, Settings → Connectors shows every connector as "not configured" and there is no Connect button. Full details: [docs/CONNECTORS_SETUP.md](docs/CONNECTORS_SETUP.md).

| Variable | Value |
|---|---|
| `CONNECTORS_ENABLED` | `true` |
| `PUBLIC_BASE_URL` | Your Vercel URL, e.g. `https://<project>.vercel.app` (no trailing slash) |
| `CONNECTOR_ENCRYPTION_KEY` | `openssl rand -base64 32` (encrypts users' GitHub/Gmail tokens) |
| `GITHUB_CONNECTOR_CLIENT_ID` / `GITHUB_CONNECTOR_CLIENT_SECRET` | From your GitHub App; callback URL `${PUBLIC_BASE_URL}/api/v1/connectors/oauth/callback` |
| `GMAIL_CONNECTOR_CLIENT_ID` / `GMAIL_CONNECTOR_CLIENT_SECRET` | A separate Google OAuth client with the Gmail API enabled; same callback URL |
| `CONNECTOR_WRITES_ENABLED` | Optional, `true` to allow approval-gated writes |
| `MCP_SERVER_ENABLED` / `MCP_OAUTH_SIGNING_SECRET` | Optional, for the ChatGPT app; the secret must differ from `APP_SESSION_SECRET` |

### 3. Generate a Firebase/GCP service-account key (new requirement)

On Cloud Run, Firestore/GCS auth was automatic (the service's own identity via Application Default Credentials). Vercel has no equivalent, so `chat-api` needs an explicit key:

1. GCP Console → IAM & Admin → Service Accounts. Use the existing one the Cloud Run services ran as, or create a new one.
2. Confirm it has the **Cloud Datastore User** role (Firestore) and read/write access to the `nexusai-generated-images` GCS bucket.
3. Generate a new JSON key for it (Keys → Add Key → Create new key → JSON).
4. Paste the entire JSON (as one line) into the `FIREBASE_SERVICE_ACCOUNT_KEY` Vercel env var.

Treat this file like any other credential — don't commit it, don't paste it anywhere but Vercel's env var UI.

### 4. The sandbox microservice

**On Vercel this is now automatic:** `infra/sandbox-service` deploys as the internal `sandbox` service with `runtime: "container"`, built from its own Dockerfile (isolated-vm is a native addon, so it can't be a regular function, but it runs fine in a container). It has no public route; only `api` can reach it, through the binding. Skip the rest of this step unless you want to keep running it on Cloud Run instead, as below:

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
- Sign in with Google, send a chat message, try image generation and the code-interpreter tool (exercises Firestore, GCS, and the new sandbox-service in one pass).
- Check Vercel's function logs for errors or timeouts. Chat responses can run long; `vercel.json` currently requests `maxDuration: 60` for the API function — raise it if your Vercel plan allows more and long generations are getting cut off.

### 7. Point your domain at Vercel, then decommission the old GCP services

Only after step 6 passes:
1. Vercel → Project → Domains → add your custom domain (or keep using the free `*.vercel.app` one), update DNS as Vercel instructs.
2. Delete the old Cloud Run services — this is what actually stops the Cloud Run billing: `gcloud run services delete chat-api --region=asia-south1` and `gcloud run services delete chat-client --region=asia-south1`.
3. Delete the external HTTPS load balancer + static IP + forwarding rules that fronted them (mentioned in the old README) — this fixed monthly cost often exceeds Cloud Run's own usage-based cost, and it has no equivalent needed on Vercel (custom domains + HTTPS are included).
4. Optionally clean up the old `chat-api`/`chat-client` images in Artifact Registry to stop storage charges (the `sandbox-service` image stays, in the same `chat-repo` repository).

I can't perform any of steps 1–7 myself — I don't have access to your Vercel account or GCP console from here. Everything in this repo is ready for you to point at once you've done the account-side setup above.
