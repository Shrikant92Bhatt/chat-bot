# Connectors & ChatGPT app — setup and operations

Implementation of [MULTI_CONNECTOR_PLATFORM_PLAN.md](./MULTI_CONNECTOR_PLATFORM_PLAN.md). This page is what you need to turn it on, and where each piece lives.

Everything is **off by default** and fails closed: a missing flag, key or client secret hides the feature instead of half-enabling it.

## 1. Turn on the platform

| Variable | Value |
|---|---|
| `CONNECTORS_ENABLED` | `true` |
| `PUBLIC_BASE_URL` | Your deployment origin, e.g. `https://nexus-ai.vercel.app` (no trailing slash) |
| `CONNECTOR_ENCRYPTION_KEY` | `openssl rand -base64 32` — encrypts provider tokens at rest. Keep it in Vercel's encrypted env vars. |
| `CONNECTOR_WRITES_ENABLED` | Leave `false` until you've tried the read tools. Even when `true`, every write needs a per-action approval click. |

With only this, **Market data**, **Paper trading** and **Social drafts** work (no external account needed). Users find everything in **Settings → Connectors**; connector tools are offered to the agent when the MCP/tools toggle is on and the user is signed in.

## 2. GitHub

Recommended: a **GitHub App** (fine-grained, the user picks which repos).

1. GitHub → Settings → Developer settings → GitHub Apps → New.
2. Callback URL: `${PUBLIC_BASE_URL}/api/v1/connectors/oauth/callback`. Tick "Request user authorization (OAuth) during installation". Enable "Expire user authorization tokens" (refresh is handled).
3. Repository permissions: Metadata, Contents, Issues, Pull requests, Actions → **Read-only**. Only if you'll enable writes: Issues → Read and write (needed for issues and comments).
4. Set `GITHUB_CONNECTOR_CLIENT_ID`, `GITHUB_CONNECTOR_CLIENT_SECRET`, `GITHUB_CONNECTOR_MODE=app`.

A classic OAuth App also works (`GITHUB_CONNECTOR_MODE=oauth`), but its `repo` scope grants full access to all private repos — there is no read-only private-repo scope for OAuth Apps.

## 3. Gmail

Use a **separate** OAuth client from the one used for NexusAI sign-in — linking Gmail must never change how users sign in.

1. Google Cloud Console → APIs & Services → enable **Gmail API**.
2. Credentials → OAuth client ID → Web application. Authorized redirect URI: `${PUBLIC_BASE_URL}/api/v1/connectors/oauth/callback`.
3. OAuth consent screen: add scopes `gmail.readonly` and (only if you'll enable writes) `gmail.compose`. Both are **restricted** scopes: until Google verifies the app, only listed test users can connect.
4. Set `GMAIL_CONNECTOR_CLIENT_ID`, `GMAIL_CONNECTOR_CLIENT_SECRET`.

Read access asks for `gmail.readonly` only; `gmail.compose` is requested incrementally the first time a user turns on "Write" for Gmail.

## 4. ChatGPT app (remote MCP server)

| Variable | Value |
|---|---|
| `MCP_SERVER_ENABLED` | `true` |
| `MCP_OAUTH_SIGNING_SECRET` | `openssl rand -hex 32` — must differ from `APP_SESSION_SECRET` or MCP stays off |
| `MCP_OAUTH_ALLOWED_REDIRECT_HOSTS` | default `chatgpt.com,chat.openai.com` |

Then in ChatGPT (Settings → Apps & Connectors → Advanced → Developer mode), create a connector with URL `${PUBLIC_BASE_URL}/api/mcp` and OAuth authentication. ChatGPT discovers everything from:

- `/.well-known/oauth-protected-resource/api/mcp` (RFC 9728)
- `/.well-known/oauth-authorization-server` (RFC 8414)
- `/api/oauth/register` (dynamic client registration), `/api/oauth/authorize`, `/api/oauth/token`, `/api/oauth/revoke`

The user approves on NexusAI's own consent screen while signed in. They can revoke any time in Settings → Connectors → ChatGPT; revocation is immediate (every MCP request re-checks the grant).

Exposed tools (read-only, named `nexus_<tool>`): `github_list_repositories`, `github_get_repository`, `github_search_issues`, `github_get_pull_request`, `github_get_workflow_failures`, `gmail_search_threads`, and `market_get_quote` only once `MARKET_DATA_LICENSED=true`. Write tools are never exposed over MCP. Results carry an Apps SDK widget (`ui://widget/nexus-result.html`).

> **Verify against current docs before publishing.** The Apps SDK widget metadata (`openai/outputTemplate`, `text/html+skybridge`) and the MCP auth profile were implemented from the MCP authorization spec and Apps SDK conventions; the OpenAI docs weren't reachable from the build environment. Test in Developer Mode first.

## 5. Data and security model

Firestore collections (all server-only — the browser never reads Firestore directly; if you add client-side Firestore rules, deny these entirely):

| Collection | Contents |
|---|---|
| `connectorConnections` | owner, provider, status, granted scopes, enabled capabilities — never secrets |
| `connectorCredentials` | AES-256-GCM envelopes, AAD-bound to owner + connection |
| `connectorOAuthStates` | single-use OAuth state keyed by its SHA-256, 10-min TTL |
| `connectorApprovals` | exact-action approvals (digest-bound, single-use); input deleted once resolved |
| `connectorAuditEvents` | redacted history (field shapes, never values), 180-day retention |
| `connectorPaperPortfolios`, `connectorSocialDrafts` | connection-scoped data, deleted on disconnect |
| `mcpOAuthClients`, `mcpOAuthGrants`, `mcpOAuthCodes`, `mcpOAuthRefreshTokens` | MCP authorization server state (codes/refresh tokens stored hashed) |

Only single-field equality queries are used, so no composite indexes are needed. Consider Firestore TTL policies on `connectorOAuthStates.expiresAt`, `mcpOAuthCodes.expiresAt` and `mcpOAuthRefreshTokens.expiresAt` to sweep abandoned rows.

Key guarantees (each covered by tests in `apps/chat-api/src/connectors/*.spec.ts` and `apps/chat-api/src/mcp-server/mcp-server.spec.ts`):

- One `ToolExecutor` for the agent, the MCP server and approval clicks — no second tool path.
- A model tool call **never** executes a write: it becomes an approval card built from the server's record. Approving runs exactly the stored, digest-verified input once, after re-checking connection, scopes and flags.
- The model's ```` ```ui ```` block cannot produce an approval card or a reserved approval action id.
- Tier 4 (live financial actions) is denied unconditionally. Paper trading is simulated.
- User A can't use, see, change, approve or disconnect anything of user B's; another user's id behaves as "not found".
- NexusAI session tokens and MCP tokens are signed with different secrets and audiences — neither works in the other's place.

## 6. Code map

```
apps/chat-api/src/connectors/
  connector.types.ts        tool/adapter contract
  connector-registry.ts     the list of connectors
  connector-manager.ts      OAuth connect/callback/refresh/disconnect
  credential-vault.ts       encryption at rest
  permission-policy.ts      deterministic allow/deny
  tool-executor.ts          the single execution path
  approval-service.ts       exact-action approvals
  audit-service.ts          redacted audit
  reliability.ts            quotas, cache, circuit breaker, size budgets
  langchain-tools.ts        LangGraph binding (per signed-in user)
  connector.routes.ts       /api/v1/connectors
  providers/                github, google (gmail), market-data, brokers (paper), social
apps/chat-api/src/mcp-server/
  mcp-oauth.service.ts      OAuth 2.1 authorization server for MCP clients
  remote-mcp-server.ts      stateless Streamable HTTP MCP server
  mcp.routes.ts             /.well-known, /api/oauth, /api/mcp, /api/v1/mcp-oauth
apps/chat-client/src/app/
  services/connector.service.ts
  components/connectors-panel/          Settings → Connectors
  components/mcp-consent-modal/         ChatGPT consent screen
  components/ui-block/components/connector-result.component.*  CONNECTOR_RESULT
  components/ui-block/components/approval-request.component.*  APPROVAL_REQUEST
```

## 7. Still open (decisions from plan §15)

- **Market data licence** — the bundled source is Yahoo's unofficial endpoint. Pick a licensed provider with Indian exchange + ETF holdings coverage, implement it in `providers/market-data/market-data.source.ts`, then set `MARKET_DATA_LICENSED=true`.
- **Social provider** — drafting works; analytics and publishing need a chosen provider (and its app review) as a new adapter in `providers/social/`.
- **Broker** — only paper trading exists. A real broker starts as a read-only adapter in `providers/brokers/`; live trading stays a separately reviewed project.
- **Managed KMS** — `KeyProvider` in `credential-vault.ts` is the seam for swapping the env key for a KMS.
