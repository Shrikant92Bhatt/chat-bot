# OmniRoute AI Gateway — deploy notes

Self-hosted LiteLLM proxy, deployed as its own Cloud Run service, separate
from `chat-api`/`chat-client`. `chat-api` talks to it as an OpenAI-compatible
endpoint via `OMNIROUTE_BASE_URL` (see `apps/chat-api/src/llm/client.ts`).

Not wired into the GitHub Actions pipeline yet — this config changes rarely
(only when the model list changes), so deploy it manually the first time,
then a few `gcloud run services update` calls keep it in sync.

## 1. First-time deploy

```bash
gcloud config set project chat-bot-505613

# Build and push the image (bakes in litellm-config.yaml)
gcloud builds submit --tag asia-south1-docker.pkg.dev/chat-bot-505613/chat-repo/omniroute-gateway:latest ./infra/omniroute

# Make sure the secrets it needs exist (reuses the same GEMINI_API_KEY the
# app already uses, plus OPENAI_API_KEY if you want GPT-4o routed through
# here too — note OPENAI_API_KEY isn't currently in chat-api's own secret
# set either, so GPT-4o isn't live in prod yet regardless of this gateway).
echo -n "<value>" | gcloud secrets create OPENAI_API_KEY --data-file=-      # if it doesn't exist yet
echo -n "<value>" | gcloud secrets create OMNIROUTE_API_KEY --data-file=-  # the gateway's own master key

# Deploy
gcloud run deploy omniroute-gateway \
  --image=asia-south1-docker.pkg.dev/chat-bot-505613/chat-repo/omniroute-gateway:latest \
  --region=asia-south1 \
  --platform=managed \
  --allow-unauthenticated \
  --set-secrets="GEMINI_API_KEY=GEMINI_API_KEY:latest,OPENAI_API_KEY=OPENAI_API_KEY:latest,OMNIROUTE_API_KEY=OMNIROUTE_API_KEY:latest"
```

`--allow-unauthenticated` is used here because the LiteLLM master key
(`OMNIROUTE_API_KEY`) is already the access control at the app layer, same
as any other OpenAI-compatible API. For tighter isolation later, switch to
`--no-allow-unauthenticated` + internal ingress and grant chat-api's Cloud
Run service account `roles/run.invoker` on this service instead.

## 2. Point chat-api at it

Take the URL Cloud Run prints for `omniroute-gateway` and wire it into
`chat-api`:

```bash
gcloud run services update chat-api \
  --region=asia-south1 \
  --update-env-vars="OMNIROUTE_BASE_URL=https://<omniroute-gateway-url>/v1"
```

**Important**: `.github/workflows/ci-cd.yml`'s `deploy-chat-api` step now
also sets `OMNIROUTE_BASE_URL` (see that file) so the next automated deploy
doesn't silently wipe this back out — update the placeholder there to the
real URL once you have it, or the next push to `main` will reset it.

## 3. Redeploying after a config change

```bash
gcloud builds submit --tag asia-south1-docker.pkg.dev/chat-bot-505613/chat-repo/omniroute-gateway:latest ./infra/omniroute
gcloud run deploy omniroute-gateway \
  --image=asia-south1-docker.pkg.dev/chat-bot-505613/chat-repo/omniroute-gateway:latest \
  --region=asia-south1
```
