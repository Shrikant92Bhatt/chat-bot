# Vercel multi-service deployment

This repository is configured for one Vercel deployment with three services:

| Service | Root | Runtime/build | Public route |
| --- | --- | --- | --- |
| `chat-client` | `.` | Angular build via `npm run build:vercel` | `/` and SPA routes |
| `chat-api` | `.` | Express entrypoint `api/index.ts` | `/api`, `/api/*`, `/health` |
| `sandbox-service` | `infra/sandbox-service` | Docker container (Node 24 + native `isolated-vm`) | None; internal only |

## Vercel project setup

1. Connect this repository to the intended Vercel project.
2. In the Vercel project settings, select the **Services** framework/mode. Services support is a Vercel beta feature and may require access to be enabled for the account.
3. Keep the project root at the repository root so the root `vercel.json` is discovered.
4. Deploy a preview first and inspect each service's build/runtime logs before promoting it to production.

## Service binding and environment variables

The `chat-api` service declares a binding to `sandbox-service`. Vercel injects `CODE_SANDBOX_SERVICE_URL` at runtime. Do not create or hardcode this variable in Vercel project settings; the binding owns it.

Set `CODE_SANDBOX_SERVICE_SECRET` as a secure environment variable for both `chat-api` and `sandbox-service` (use the same generated random value for both). The sandbox endpoint returns HTTP 503 in production if the secret is missing, and HTTP 401 when the supplied secret does not match. Do not commit the secret or put it in a frontend-visible variable.

Other API provider credentials and application configuration still need to be added through Vercel's encrypted environment-variable settings as required by the application. The frontend build defaults to same-origin API requests; do not set `API_URL` unless the API is deliberately moved to another origin.

## Routing behavior

- `/api` and `/api/*` are sent to `chat-api`; the API retains its existing `/api/...` route prefixes.
- `/health` is sent to `chat-api`.
- All remaining public paths go to `chat-client`. A service-local rewrite sends Angular deep links to `/index.html` while leaving asset/file paths alone.
- `sandbox-service` has no top-level public rewrite. It is reachable by the binding from `chat-api`, not by a public `/execute` or `/health` path.

## Native dependency validation

The sandbox is configured as a container service rather than a serverless-function bundle because `isolated-vm` is a native Node/V8 addon. Its Dockerfile builds the addon and TypeScript output in a Debian-based Node 24 image, then runs the compiled service as a non-root user. This is a compatibility-oriented configuration, not proof that the Vercel container build has succeeded; confirm the container build and a real sandbox execution in a Vercel preview deployment.

## Smoke tests after deployment

1. Open the root URL and refresh a nested Angular route; it should return the SPA rather than a 404.
2. Request `/health`; expect JSON with `status: "ok"` and `service: "chat-api"`.
3. Exercise a normal authenticated API route under `/api/...`.
4. Run the code-interpreter feature; verify the API calls the bound sandbox URL and receives a successful execution result.
5. Confirm there is no public rewrite to `sandbox-service`, and verify the feature fails closed if `CODE_SANDBOX_SERVICE_SECRET` is missing or incorrect.
