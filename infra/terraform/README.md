# Terraform IaC — NexusAI Enterprise Chat

Code-only Terraform scaffold for the GCP resources behind `apps/chat-api` and
`apps/chat-client`. **Nothing has been provisioned or planned with this yet** —
no `terraform init`/`plan`/`apply` has been run against any real project.

This is deliberately additive: the app already runs today via
`.github/workflows/ci-cd.yml` calling `gcloud builds submit` / `gcloud run
deploy` directly, and `cloudbuild.yaml` builds the two Docker images. This
Terraform describes the same target state as code, so it can eventually
replace those imperative `gcloud` steps — see "Adopting against an existing
project" below for how to do that without downtime or resource duplication.

## Layout

```
infra/terraform/
  environments/{dev,staging,prod}/   # root modules — one state per environment
    main.tf                          # provider config + module wiring
    variables.tf                     # inputs, with environment-appropriate defaults
    backend.tf                       # empty `backend "gcs" {}` — operator supplies bucket
    terraform.tfvars.example         # copy to terraform.tfvars (gitignored) and fill in
  modules/
    artifact-registry/   # one Docker repo (default "chat-repo") for both images
    cloud-run/            # two google_cloud_run_v2_service: chat-api + chat-client
    firestore/            # one Native-mode Firestore database
    storage/              # one GCS bucket (uploads + generated images)
    iam/                  # chat-api runtime service account, least-privilege roles
    secret-manager/       # empty secret containers for the app's API keys/secrets
    pubsub/               # topics for a future async pipeline (not wired to app code)
    redis/                # Memorystore, opt-in (disabled by default)
    monitoring/           # Cloud Run error-rate + latency alert policy stubs
```

Each environment's `main.tf` wires the modules together the same way; only
`variables.tf` defaults and `terraform.tfvars` differ (project ID, bucket
name, Firestore database ID, instance counts, etc).

## How each module maps to the running app

This mapping was read directly out of `.agents/PROJECT_CONTEXT.md`,
`.agents/AGENTS.md`, `Dockerfile.api`, `Dockerfile.client`, `cloudbuild.yaml`,
and `.github/workflows/ci-cd.yml` — not guessed:

| Module | Real resource | Backs |
|---|---|---|
| `cloud-run` | `chat-api`, `chat-client` services | The two images `cloudbuild.yaml` builds from `Dockerfile.api` / `Dockerfile.client`. Both listen on `PORT=8080` (see `ENV PORT=8080` / `EXPOSE 8080` in the Dockerfiles). |
| `firestore` | Native-mode DB, ID `nexus-ai` | `FIRESTORE_DATABASE_ID` env var, already set in `ci-cd.yml`'s `gcloud run deploy chat-api` step. Backs the user registry + thread history (AGENTS.md: "DB: Firestore"). |
| `storage` | bucket `nexusai-generated-images` | `GCS_BUCKET_NAME`, read by `apps/chat-api/src/storage/uploader.ts` and `metrics.ts`. |
| `secret-manager` | secrets for the 5 keys below | `apps/chat-api`'s env var table in PROJECT_CONTEXT.md. |
| `iam` | `chat-api-sa` service account | Runtime identity for the `chat-api` Cloud Run service, scoped to exactly what `uploader.ts`/`metrics.ts` (Storage), the Firestore client, and Secret Manager reads actually need. `chat-client` is static NGINX with no GCP API calls, so it keeps the Cloud Run default compute identity — no dedicated SA. |
| `artifact-registry` | repo `chat-repo` | Already hardcoded in `cloudbuild.yaml` and `ci-cd.yml`'s image tags. |
| `pubsub` | topics `file.uploaded`, `document.processing`, `document.embedding` | **Not called from app code yet.** `rag/retriever.ts` and `vector-db.ts` currently run in-process/synchronously; nothing publishes or subscribes to Pub/Sub today. Provisioned ahead of time per the task spec, for a future async ingestion pipeline. |
| `redis` | Memorystore instance | **Not called from app code yet.** AGENTS.md's feature matrix lists rate limiting as already working without Redis. Disabled by default (`enable_redis = false` in every environment) since Memorystore has no free tier — flip it on only once a distributed limiter is actually built. |
| `monitoring` | 2 alert policies per Cloud Run service | Basic error-rate (5xx/sec) and p99 latency stubs. `notification_channels` defaults to `[]`, so policies exist but page no one until you add channels. |

### Secrets — what's included and one deliberate deviation from the task spec

The task asked for a `secret-manager` module covering exactly: `GEMINI_API_KEY`,
`OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `APP_SESSION_SECRET`,
`GOOGLE_CLIENT_ID`. That's what `modules/secret-manager/variables.tf`'s
`secret_ids` default list contains, and it's what's implemented.

Worth flagging: `ci-cd.yml`'s actual `gcloud run deploy` step passes
`GOOGLE_CLIENT_ID` as a **plain** `--set-env-vars` value (it's an OAuth client
ID — not confidential, it ships to the browser), and instead pulls a
`GOOGLE_CLIENT_SECRET` from Secret Manager, which doesn't appear anywhere in
PROJECT_CONTEXT.md's env var table. This Terraform follows the task's literal
5-secret list and wires `GOOGLE_CLIENT_ID` as a **plain** Cloud Run env var
(matching real-world usage), not a secret — the secret container for it still
gets created (per spec) but nothing reads from it. If your OAuth flow needs a
client secret server-side, add `"GOOGLE_CLIENT_SECRET"` to `secret_ids` in
`modules/secret-manager/variables.tf` and add a matching line to
`api_secret_env_vars` in each environment's `main.tf`.

**Operational gotcha:** `google_cloud_run_v2_service` secret env vars pin to
`version = "latest"`, and Cloud Run refuses to deploy if a referenced secret
has zero versions. Every secret wired into `api_secret_env_vars` (including
optional ones like `OPENAI_API_KEY`) needs at least one version — even an
empty placeholder — before the first `terraform apply`. Either:
- pass real values via `secret_manager`'s `secret_values` variable (never in
  a committed `terraform.tfvars` — use a gitignored `*.auto.tfvars` or
  `TF_VAR_secret_values` instead), or
- `gcloud secrets versions add <NAME> --data-file=-` by hand after the
  secrets exist, before running `apply` again for `cloud-run`.

## Applying (operator steps — none of this has been run)

1. **State backend.** `environments/<env>/backend.tf` declares an empty
   `backend "gcs" {}` (backend config can't reference variables). Either edit
   the file in place or pass flags at init time:
   ```bash
   cd infra/terraform/environments/dev
   terraform init \
     -backend-config="bucket=chat-bot-tfstate-dev" \
     -backend-config="prefix=terraform/state"
   ```
   The state bucket itself isn't managed by this config — create it once by
   hand (`gsutil mb` + `gsutil versioning set on`).

2. **Variables.** `cp terraform.tfvars.example terraform.tfvars` and fill in
   `project_id` plus anything else you want to override. Don't commit
   `terraform.tfvars`.

3. **Plan / apply**, per environment:
   ```bash
   terraform plan
   terraform apply
   ```

4. **CI/CD.** `.github/workflows/ci-cd.yml` still deploys via raw `gcloud`
   commands — this Terraform doesn't change that today. Once you're
   comfortable with the plans it produces, the natural next step is swapping
   the `deploy-to-cloud-run` job for `terraform apply` against the `prod`
   environment, but that's out of scope here.

### Adopting against an existing project

`prod`'s `terraform.tfvars.example` mirrors what `ci-cd.yml` already deploys
by hand (`project_id = "chat-bot-505613"`, bucket
`nexusai-generated-images`, Firestore DB `nexus-ai`, etc.) specifically so a
`plan` against the real project comes out close to a no-op instead of trying
to recreate everything. Even so, run `terraform import` for each existing
resource (Cloud Run services, the Firestore database, the bucket, the
Artifact Registry repo, the existing secrets) before your first `apply` —
otherwise Terraform will try to create resources that already exist and
fail/conflict.

## Assumptions / defaults worth knowing about

- **Region:** `asia-south1` everywhere, matching every hardcoded region in
  `cloudbuild.yaml` and `ci-cd.yml`.
- **Cost posture:** every module defaults to the cheapest viable
  configuration — Cloud Run `min_instance_count = 0` in all three
  environments, `redis` disabled by default (Memorystore has no free tier,
  unlike everything else here), no lifecycle rules deleting storage objects
  unless explicitly enabled. Nothing here implies ongoing spend until you
  run `apply`.
- **`allow_unauthenticated = true`** on both Cloud Run services by default,
  matching `--allow-unauthenticated` already used in `ci-cd.yml`. Access
  control is enforced at the app layer (Google OAuth2 + session JWT on
  `/api/chat/*`), not via Cloud Run IAM.
- **`google-beta` provider** is declared in every environment's
  `required_providers` but currently unused — every resource here is GA in
  the `google` provider. Kept declared per the task's "use `google` and
  `google-beta` as needed" so a future beta-only resource doesn't need an
  environment-level change.
- **No `terraform init`/`plan`/`apply` has been run.** `terraform` isn't
  installed in the environment this scaffold was written in, so syntax was
  hand-verified against current `google` provider (~> 5.0) resource shapes
  rather than `terraform validate`. Run `terraform validate` yourself before
  the first real `plan`.
