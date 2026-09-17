// Vercel serverless function entrypoint. Vercel's Node builder bundles this
// file (and everything it imports, including the `@chat-monorepo/shared`
// path alias, resolved via the root tsconfig.json) and invokes the default
// export as a standard (req, res) request handler - an Express app's
// signature matches that directly, so no adapter is needed.
//
// IMPORTANT: apps/chat-api/src/app.ts (and everything it imports) must never
// import the isolated-vm-based code sandbox directly - see
// apps/chat-api/src/tools/code-sandbox.ts, which calls out over HTTP to
// CODE_SANDBOX_SERVICE_URL instead. isolated-vm is a native addon that
// cannot run inside a Vercel serverless function.
import app from '../apps/chat-api/src/app';

export default app;
