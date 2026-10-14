# Environment variables

Every variable `chat-api` reads, generated from the code (`process.env.*`). Paste-ready version: [`.env.production.template`](../.env.production.template). Random secrets: `bash scripts/generate-secrets.sh`.

**Required** means the feature doesn't work without it. Everything else has a safe default or degrades gracefully.

## Core app

| Variable | Required | Where it comes from | Used for |
|---|---|---|---|
| `OPENROUTER_API_KEY` | Yes | openrouter.ai/keys (or GCP Secret Manager) | Main chat model gateway, web search, images |
| `OPENROUTER_BASE_URL` | No | `https://openrouter.ai/api/v1` | Gateway URL |
| `GEMINI_API_KEY` | Yes | aistudio.google.com/apikey (or Secret Manager). `GOOGLE_API_KEY` is accepted as an alias | Summaries, memory, suggestions, fallback chat |
| `GOOGLE_CLIENT_ID` | Yes | Google Cloud → Credentials (public) | Verifying Google Sign-In |
| `APP_SESSION_SECRET` | Yes | Reuse the GCP value (a new one signs everyone out) | Signing session tokens |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Yes on Vercel | GCP service-account JSON key, one line | Firestore + Cloud Storage access |
| `FIRESTORE_DATABASE_ID` | Yes | `nexus-ai` | Which Firestore database |
| `GCS_BUCKET_NAME` | Recommended | `nexusai-generated-images` | Storing generated images/uploads (falls back to inline data) |
| `OPENAI_API_KEY` | No | platform.openai.com | Legacy direct-OpenAI fallback only |
| `OMNIROUTE_BASE_URL`, `OMNIROUTE_API_KEY` | No | Self-hosted gateway | Only when not using OpenRouter |
| `CODE_SANDBOX_SERVICE_URL`, `CODE_SANDBOX_SERVICE_SECRET` | No | Deployed `infra/sandbox-service` | Code interpreter tool |
| `ETF_SCREENER_MCP_URL`, `ETF_SCREENER_MCP_SECRET` | No | Your etf-screener deployment `/api/mcp` + its `MCP_API_SECRET` | ETF screener tools |
| `ANON_TRIAL_MESSAGE_LIMIT`, `AUTH_DAILY_MESSAGE_LIMIT`, `RATE_LIMIT_WINDOW_HOURS` | No | Defaults 1 / 20 / 24 | Initial rate limits (admin console overrides) |
| `RESEARCH_PLANNER_MODEL` | No | Default `gemini-flash-latest` | Deep-research planner model |
| `HEADROOM_ENABLED` | No | Default on; `false` disables | Context compression |
| `ALLOWED_ORIGIN`, `API_URL` | No | Only for a split-origin deployment | CORS / client API base URL |

`GOOGLE_CLIENT_SECRET` is **not read by the code**. Sign-in only needs the client ID, so you can skip it.

## Connectors

| Variable | Required | Value |
|---|---|---|
| `CONNECTORS_ENABLED` | Yes | `true` |
| `PUBLIC_BASE_URL` | Yes | Deployment URL, no trailing slash |
| `CONNECTOR_ENCRYPTION_KEY` | Yes for GitHub/Gmail | Generated (32 bytes, base64) |
| `GITHUB_CONNECTOR_CLIENT_ID`, `GITHUB_CONNECTOR_CLIENT_SECRET` | For GitHub | GitHub App credentials |
| `GITHUB_CONNECTOR_MODE` | No | `app` (default) or `oauth` |
| `GITHUB_CONNECTOR_READ_SCOPES`, `GITHUB_CONNECTOR_WRITE_SCOPES` | No | Only for `mode=oauth` |
| `GMAIL_CONNECTOR_CLIENT_ID`, `GMAIL_CONNECTOR_CLIENT_SECRET` | For Gmail | Separate Google OAuth client |
| `CONNECTOR_WRITES_ENABLED` | No | `false` (default) / `true` |
| `CONNECTOR_APP_REDIRECT_URL` | No | Defaults to `PUBLIC_BASE_URL` |
| `CONNECTOR_ENCRYPTION_KEY_PREVIOUS` | No | Old key during rotation |
| `CONNECTOR_OAUTH_BROWSER_BINDING` | No | `true` (default); `false` only for split-origin |
| `CONNECTOR_APPROVAL_TTL_SECONDS`, `CONNECTOR_OAUTH_STATE_TTL_SECONDS` | No | Default 600 each |
| `CONNECTOR_PROVIDER_CALL_LIMIT`, `CONNECTOR_RATE_LIMIT_WINDOW_MINUTES` | No | Default 200 calls / 60 min per user per provider |
| `CONNECTOR_MAX_RESULT_CHARS` | No | Default 24000 |
| `MARKET_DATA_PROVIDER` | No | `yahoo` (default) or `none` |
| `MARKET_DATA_LICENSED` | No | `true` only with a licensed data source |
| `PAPER_BROKER_STARTING_CASH`, `PAPER_BROKER_BASE_CURRENCY`, `PAPER_BROKER_MAX_ORDER_QTY`, `PAPER_BROKER_MAX_ORDER_NOTIONAL` | No | 1000000 / INR / 10000 / 500000 |

## ChatGPT app (MCP server)

| Variable | Required | Value |
|---|---|---|
| `MCP_SERVER_ENABLED` | For ChatGPT | `true` |
| `MCP_OAUTH_SIGNING_SECRET` | For ChatGPT | Generated; ≥ 32 chars, must differ from `APP_SESSION_SECRET` |
| `MCP_OAUTH_ALLOWED_REDIRECT_HOSTS` | No | Default `chatgpt.com,chat.openai.com` |

## GitHub Actions secrets (not Vercel)

| Secret | Used by |
|---|---|
| `VERSION_BUMP_TOKEN` | Fine-grained PAT, this repo, Contents: read & write. Lets version-bump commits trigger CI without manual approval |
| `GCP_SA_KEY` | Sandbox-service deploy job (already set) |

## Where to get each external credential

- **Existing secrets** (`OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `APP_SESSION_SECRET`): GCP Console → Security → Secret Manager → open the secret → latest version → *View secret value*.
- **Service-account key**: GCP Console → IAM & Admin → Service Accounts → the account Cloud Run used → Keys → Add key → JSON. Then turn the file into one line: `jq -c . key.json`.
- **GitHub App**: github.com/settings/apps/new. Callback `${PUBLIC_BASE_URL}/api/v1/connectors/oauth/callback`, read-only permissions listed in [CONNECTORS_SETUP.md](./CONNECTORS_SETUP.md), then install it on the repos you want.
- **Gmail client**: Google Cloud → APIs & Services → enable Gmail API → Credentials → Create OAuth client (Web), redirect URI as above; add yourself as a test user on the consent screen.
- After deploying, add the Vercel URL to the **sign-in** OAuth client's *Authorized JavaScript origins*.
