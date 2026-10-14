# NexusAI Multi-Connector Platform & ChatGPT App — Implementation Plan

**Status:** Proposed  
**Repository:** Shrikant92Bhatt/chat-bot  
**Branch:** docs/multi-connector-platform-plan  
**Goal:** Evolve NexusAI into a secure multi-service AI agent platform, then expose selected capabilities through a ChatGPT app using MCP and the OpenAI Apps SDK.

---

## 1. Goals and non-goals

### Goals

1. Let users connect and manage external accounts from NexusAI.
2. Expose provider capabilities through a consistent connector/tool contract.
3. Let LangGraph select and combine tools across connected services.
4. Normalize tool results so the Angular UI can render useful tables, cards, links and status summaries.
5. Expose selected capabilities through a remotely hosted MCP endpoint for compatible ChatGPT app workflows.
6. Enforce identity, least-privilege authorization, explicit write approvals, auditability, rate limits and safe failure behavior.
7. Start with read-only integrations and add write capabilities incrementally.

### Non-goals for the first release

- Replacing LangGraph, the existing LLM gateway, RAG, memory, projects or summarization.
- Building every provider at once.
- Automatically sharing NexusAI conversation history or private memory with ChatGPT.
- Unrestricted autonomous social publishing, email sending, or live trading.
- Treating model-generated text as validated financial instructions.

## 2. Existing foundation to preserve

Based on the repository README and architecture documentation, the application already has:

- Nx monorepo with Angular standalone-component frontend and Express backend.
- LangGraph agent/tool loop and multi-provider model access through OpenRouter.
- Existing MCP/tool definitions for calculator, sandboxed code execution, image generation and web search.
- Google Sign-In, Firestore persistence, rate limiting and usage/cost tracking.
- Project instructions, RAG retrieval, long-term memory and conversation summarization.
- Vercel deployment for the main application and a separate sandbox service for isolated code execution.

Before implementation, inspect the current tool registration, LangGraph graph, auth middleware, API routing, environment configuration and UI-tool/result adapter. Reuse existing patterns where possible; do not create a second competing tool framework.

## 3. Target architecture

    NexusAI Angular UI                         ChatGPT app UI
            |                                        |
            | existing chat API                      | MCP over HTTPS
            v                                        v
            +---------- Shared connector services ---+
                               |
                     Identity & authorization
                               |
                 Connector registry / manifests
                               |
                  Schema validation & policy
                               |
                  Tool execution / approvals
                               |
                     Provider adapters
              /           |          |            \
          GitHub       Google      Social       Finance
                       Gmail       APIs       Market data
                                               / brokers
                               |
                     Normalized tool results
                               |
                 Audit logs / usage / metrics

### Architectural rules

- NexusAI and ChatGPT are separate clients. They can call shared services, but must not implicitly share session tokens, conversation histories or memories.
- MCP is a tool interoperability protocol, not an authorization or credential vault. Those controls remain application responsibilities.
- Provider-specific API logic belongs in adapters; orchestration should depend on tool contracts rather than provider SDK details.
- All connector calls must be scoped to the authenticated user and an explicitly linked connection.
- External content (emails, repository files, issues, comments and web pages) is untrusted data, never an instruction that overrides system policy.
- The model may propose tool calls; deterministic server-side policy decides whether they are allowed.

## 4. Proposed code organization

Use these as proposed additions; adapt names to the actual repository after source inspection.

    apps/chat-api/src/
      connectors/
        connector.types.ts
        connector-registry.ts
        connector-manager.ts
        connector.routes.ts
        credential-vault.ts
        permission-policy.ts
        tool-executor.ts
        approval-service.ts
        audit-service.ts
        providers/
          github/
          google/
          social/
          market-data/
          brokers/
      mcp/
        existing tool definitions
        remote-mcp-server.ts
      routes/
        existing routes
    libs/shared/
      shared DTOs and validated schemas
    apps/chat-client/src/app/
      connector settings / connect-account / approval UI

Do not place secrets in shared DTOs or return access/refresh tokens to the browser or model.

## 5. Connector contract

Define and validate a provider-independent contract. This is illustrative and must be adapted to current project conventions:

    interface ConnectorAdapter {
      id: string;
      getManifest(): Promise<ConnectorManifest>;
      connect(userId: string): Promise<ConnectionResult>;
      listTools(connectionId: string): Promise<ToolDefinition[]>;
      execute(
        connectionId: string,
        toolName: string,
        input: unknown
      ): Promise<ToolResult>;
      disconnect(connectionId: string): Promise<void>;
    }

Each tool manifest should specify:

- Stable tool name and version.
- Description and JSON input/output schema.
- Required provider scopes and resource restrictions.
- Read-only versus write/destructive classification.
- Whether approval is required.
- Timeout, rate-limit and retry policy.
- Idempotency behavior for writes.
- Cacheability and freshness requirements.
- Output size limits and source/provenance metadata.

The executor must validate input before calling a provider and validate/normalize output before returning it to the model or UI. Never accept an arbitrary provider URL or arbitrary API method from model input.

## 6. Connection and credential lifecycle

### Connection lifecycle

1. User selects a provider in NexusAI settings.
2. Server creates a short-lived, single-use OAuth state value bound to the user and intended provider.
3. Browser is redirected to the provider's official authorization endpoint.
4. Callback validates state, issuer/redirect expectations and authorization response.
5. Server exchanges the code and stores credentials securely.
6. UI shows provider, granted scopes, connection status and last successful use—never tokens.
7. On use, server verifies connection ownership, token validity and requested scopes.
8. Disconnect revokes credentials with the provider where supported and deletes local secrets/connection records.

### Security requirements

- Use least-privilege OAuth scopes; request additional scopes only when the user enables the related capability.
- Encrypt credentials at rest using a managed secret/KMS facility where available; separate ciphertext from metadata.
- Never log authorization codes, access tokens, refresh tokens, cookies or sensitive email contents.
- Rotate/refresh tokens server-side and handle revocation/expiry safely.
- Protect OAuth state against CSRF and replay; use secure, HTTP-only, appropriately configured cookies for browser sessions.
- Enforce user/tenant ownership in every connection lookup and tool invocation.
- Keep application sign-in separate from provider account linking.
- Define retention and deletion behavior for cached provider data and audit records.
- Add security tests for cross-user access, revoked credentials, expired tokens and insufficient scopes.

## 7. Tool execution and approval policy

Classify actions into risk tiers:

| Tier | Examples | Default policy |
|---|---|---|
| 0 — Local/pure | Calculator, deterministic formatting | Run normally with bounded inputs |
| 1 — External read | Read repository metadata, search Gmail, fetch market prices | Require valid linked connection and least-privilege scope |
| 2 — Reversible write | Create a draft, open an issue, add a comment | Show intended target and content; require confirmation by default |
| 3 — Consequential write | Send email, publish social content, merge PR, change account settings | Explicit, action-specific confirmation; re-check permissions immediately before execution |
| 4 — Financial action | Submit, amend or cancel a live order | Out of scope for initial release; future isolated execution/risk service, strict limits and explicit approval |

Approval must bind to the exact action, target, material parameters and a short expiry. If the model changes the action after approval, request approval again. Use idempotency keys where supported and record the final provider response. A user approval does not bypass provider authorization or risk checks.

## 8. Initial connector priorities

### Phase A — GitHub (first provider)

Read-only initial tools:
- List authorized repositories.
- Read repository metadata and selected files.
- Search issues and pull requests.
- Read PR metadata and review state.
- Read workflow runs and failed check summaries.

Controlled write follow-up:
- Create an issue.
- Draft/add a comment after displaying repository, issue/PR target and exact text.

Use a GitHub App or OAuth approach appropriate to the required access. Prefer installation/repository-level permissions when possible; do not request broad repository access by default.

### Phase B — Gmail / Google Workspace

Read-only initial tools:
- Search messages using a constrained query.
- Retrieve a selected thread.
- Summarize a thread and extract dates/action items with citations/links to source messages.

Later:
- Create a draft.
- Send a message only after explicit confirmation of recipients, subject and full body.

Use Google's current OAuth and Gmail API scope guidance. Keep Gmail authorization separate from Google Sign-In for NexusAI.

### Phase C — Social media

- Start with analytics, account/profile insights and post-draft generation.
- Select a provider only after verifying supported networks, write operations, pricing, API restrictions and OAuth review requirements.
- Add scheduling/publishing only for platforms and accounts where the provider grants the necessary permission.
- Confirm account, channel, content and schedule before publishing.

### Phase D — Finance and trading

First implement read-only market-data tools:
- Instrument lookup and price/time-series retrieval.
- ETF facts/holdings from traceable sources.
- Technical indicator calculation using deterministic code.
- Portfolio exposure and risk summaries from explicitly connected account data.

Keep market-data providers and broker adapters separate. Broker integration begins read-only, followed by paper trading. Live trading is a later, separately reviewed project with a deterministic risk layer, instrument/quantity validation, buying-power checks, market-hours handling, idempotency, order-state reconciliation and explicit confirmation. Do not allow the LLM to bypass these checks.

## 9. MCP / ChatGPT app integration

### Recommended approach

Build a remote MCP endpoint exposing a curated subset of NexusAI tools. Use the official Model Context Protocol SDK and the OpenAI Apps SDK according to their current documentation. Confirm the supported transport, authentication profile and ChatGPT plan/workspace availability at implementation time.

### Requirements

- HTTPS endpoint reachable by the target ChatGPT environment.
- MCP tool manifests with clear descriptions and strict schemas.
- Supported OAuth flow for user-specific protected resources, if required.
- Identity mapping that is explicit and secure; never trust a user ID supplied only in tool arguments.
- Per-tool and per-resource authorization on every invocation.
- Output limits, safe error messages, timeouts and rate limits.
- No credential or sensitive prompt data in logs.
- Clear separation of ChatGPT identity/session from NexusAI browser sessions.
- Optional Apps SDK UI for workflows that benefit from interactive tables/cards; the tool API must still work without a custom UI.
- Manual testing in Developer Mode where available, followed by the relevant review/publishing process if distribution is intended.

Do not assume the existing Vercel function can host every MCP transport or long-running operation unchanged. Validate the current platform limits. If needed, deploy MCP as a separate small service while keeping connector services shared.

### Suggested initial ChatGPT tools

- nexus_github_search_issues
- nexus_github_get_pull_request
- nexus_github_get_workflow_failures
- nexus_gmail_search_threads (only after Gmail OAuth is ready)
- nexus_market_get_quote (only after a licensed/approved data source is selected)

Start with read-only tools. Add writes only after the approval protocol is implemented and tested.

## 10. UI and normalized results

Add a Connector Settings area with:
- Available providers and capabilities.
- Connect/disconnect status.
- Granted scopes and last connection check.
- Reconnect and revoke flows.
- Per-provider capability toggles.
- Audit/history view for writes and approvals.

Use a common result envelope, for example:

    interface ToolResult<T = unknown> {
      ok: boolean;
      connectorId: string;
      toolName: string;
      data?: T;
      sources?: Array<{ title: string; url?: string; retrievedAt?: string }>;
      error?: {
        code: string;
        message: string;
        retryable: boolean;
      };
      metadata?: {
        durationMs?: number;
        cached?: boolean;
        truncated?: boolean;
      };
    }

Keep machine-readable data separate from display text. UI components should render typed results, not infer arbitrary widgets from untrusted provider HTML. Preserve source links and retrieval timestamps. Do not fabricate missing fields.

## 11. Data model proposal

Adapt these collections to the existing Firestore data model after reviewing current conventions and indexes:

- connectorConnections: owner UID, provider ID, status, granted scopes, provider account identifier, timestamps, credential reference.
- connectorCredentials: encrypted credential payload or reference to a managed secret; tightly restricted server-only access.
- connectorApprovals: owner UID, action digest, exact action summary, target, expiry, state, approver and execution outcome.
- connectorAuditEvents: owner UID, connection ID, tool name, risk tier, approval reference, outcome, timing and redacted metadata.
- connectorSyncState: optional cursor/checkpoint for future sync jobs.

Use server-side access controls and ownership checks. Never store plaintext OAuth secrets in ordinary connection documents. Add Firestore indexes deliberately and test behavior under multiple server instances.

## 12. Reliability, cost and performance

- Discover tools once per request or cache manifests safely; avoid loading every connector's full schema into every prompt.
- Filter available tools by user connections, intent and permission before presenting them to the model.
- Use parallel calls only when independent and safe; sequence dependent actions.
- Set per-provider deadlines, output limits, bounded retries and circuit breakers where justified.
- Do not automatically retry non-idempotent writes.
- Cache only data with a defined freshness policy; never share private cache entries across users.
- Track provider latency/errors, model tokens/cost, tool-call count and approval conversion.
- Keep raw emails, tokens, private repository content and account data out of telemetry.
- Continue using existing Firestore rate limiting/usage tracking where appropriate, but add provider-specific quotas.

## 13. Testing and release gates

### Unit tests
- Manifest/schema validation.
- Permission policy by user, connection, scope and risk tier.
- OAuth state validation and callback errors.
- Token expiry/revocation handling.
- Output normalization and truncation.
- Approval expiry, parameter mismatch and duplicate execution.
- Redaction of sensitive data.

### Integration tests
- GitHub read operations with a test repository.
- Gmail search with a dedicated test account and minimum scopes.
- MCP initialize/list-tools/call-tool flows.
- Provider rate-limit and transient-error behavior.
- Firestore ownership isolation across two users.
- UI rendering for success, empty, partial, truncated and error results.

### End-to-end/security tests
- User A cannot access User B's connector or cached results.
- Prompt injection embedded in an issue/email cannot authorize a new action.
- Expired/revoked tokens fail closed.
- A changed write payload cannot reuse an old approval.
- A duplicate write does not create unintended duplicate actions where idempotency is supported.
- Logs contain no tokens or secrets.
- NexusAI and ChatGPT clients cannot use each other's session credentials.

### CI gates
- Typecheck, lint, build and unit tests.
- Integration tests with mocked providers by default.
- Secrets scanning and dependency auditing.
- Live-provider tests only in a controlled environment using dedicated test accounts.

## 14. Implementation phases and exit criteria

### Phase 0 — Source inspection and design
- Trace existing MCP tool registration and LangGraph tool loop.
- Trace auth middleware and user identity propagation.
- Trace existing UI tool-result adapter and structured rendering.
- Review environment variable/secrets patterns and Vercel deployment constraints.
- Finalize connector contracts and data model.

**Exit:** design reviewed; no duplicate tool execution path introduced.

### Phase 1 — Connector foundation
- Implement registry, manifests, schema validation and normalized results.
- Add connection metadata and credential-vault abstraction.
- Add permission policy, audit events and approval state model.
- Add feature flags so the new path can be enabled incrementally.

**Exit:** tested fake connector works end-to-end; cross-user access tests pass.

### Phase 2 — GitHub read-only MVP
- Implement authorization and GitHub read-only tools.
- Add connector settings/status UI.
- Register tools in LangGraph through the shared executor.
- Render structured source-linked results.

**Exit:** user can link a test account, inspect authorized repo/PR/workflow data, disconnect, and prove another user cannot access it.

### Phase 3 — Controlled writes and Gmail
- Add action-specific approval flow.
- Add GitHub issue creation/commenting after confirmation.
- Add Gmail search/thread retrieval using minimum scopes.
- Add redacted audit history and failure recovery.

**Exit:** writes cannot execute without valid approval and fresh authorization.

### Phase 4 — Remote MCP and ChatGPT app
- Expose curated read-only tools through MCP.
- Deploy and configure supported authentication.
- Test with the intended ChatGPT plan/workspace and Developer Mode.
- Add optional Apps SDK UI if it provides meaningful value.

**Exit:** tools work from both clients against the same service layer, with separate sessions and enforced user/resource authorization.

### Phase 5 — Social and finance
- Add social analytics and drafting first.
- Add licensed market-data/ETF-analysis providers.
- Add broker read-only account data and paper-trading workflows.
- Treat live execution as a separate security and compliance review.

**Exit:** provider-specific permissions, data provenance, risk limits, audit and operational monitoring are verified.

## 15. Decisions to make before coding

1. OAuth strategy: provider OAuth per user; choose GitHub App versus OAuth based on desired repository access.
2. Secret storage: select a managed secret/KMS solution compatible with the deployment budget.
3. MCP hosting: validate Vercel transport/runtime limits versus a small dedicated service.
4. ChatGPT availability: verify account/workspace plan and current connector permissions.
5. Social provider: choose based on target networks and API approval requirements.
6. Market data: select data sources based on Indian exchange coverage, ETF holdings freshness, licensing and cost.
7. Broker: select an officially supported API and keep live trading disabled initially.

## 16. Acceptance criteria for the first useful release

- A user can connect and disconnect GitHub securely.
- The connector registry lists only tools available to that user and connection.
- LangGraph can call authorized GitHub read tools through the common executor.
- Tool results have validated schemas and usable source links.
- The Angular UI displays loading, empty, success, partial and failure states.
- All connector operations enforce ownership and least-privilege scopes.
- Secrets are encrypted and never exposed to the client, LLM or logs.
- Read-only tools work without enabling any write permission.
- Audit events record tool execution without sensitive payload leakage.
- Unit, integration, build and security tests pass.
- The design is ready to expose selected tools over MCP without duplicating provider business logic.

## 17. Official documentation to verify during implementation

Use current official documentation rather than relying on copied examples:

- Model Context Protocol: https://modelcontextprotocol.io/
- OpenAI Apps SDK: https://developers.openai.com/apps-sdk/
- OpenAI MCP server guidance: https://developers.openai.com/plugins/build/mcp-server
- OpenAI authentication guidance: https://developers.openai.com/plugins/build/auth
- GitHub REST API: https://docs.github.com/en/rest
- Google OAuth 2.0: https://developers.google.com/identity/protocols/oauth2
- Gmail API: https://developers.google.com/workspace/gmail/api
- Firestore security and data modeling: https://firebase.google.com/docs/firestore

---

**Recommended first implementation:** Phase 0 followed by Phase 1 and the GitHub read-only MVP. Do not start with all providers or live trading. The connector contract, identity boundary and permission model are the foundation that will make the later integrations reusable.
