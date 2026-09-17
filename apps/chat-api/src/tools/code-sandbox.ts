/**
 * HTTP client for the `code_interpreter` MCP tool's execution backend.
 *
 * The actual isolated-vm sandbox lives in its own standalone microservice
 * (infra/sandbox-service) rather than in-process here, because isolated-vm
 * is a native addon that cannot run inside a Vercel serverless function
 * (chat-api's runtime since the GCP -> Vercel migration). This module just
 * forwards the request to that service over HTTP.
 *
 * CODE_SANDBOX_SERVICE_URL must point at a running infra/sandbox-service
 * instance (e.g. a small scale-to-zero Cloud Run service). If unset, the
 * tool is disabled by returning a clear error rather than silently no-op'ing.
 */

export type SandboxLanguage = 'javascript' | 'typescript';

export interface CodeSandboxOptions {
  language?: SandboxLanguage;
}

export type SandboxExitReason =
  | 'completed'
  | 'timeout'
  | 'memory_limit'
  | 'compile_error'
  | 'runtime_error'
  | 'output_limit';

export interface CodeSandboxResult {
  success: boolean;
  stdout: string;
  stderr: string;
  /** JSON-stringified return value of the snippet, or null if nothing was returned. */
  result: string | null;
  error: string | null;
  exitReason: SandboxExitReason;
  durationMs: number;
}

// The sandbox service enforces its own hard timeout on the code itself
// (CODE_SANDBOX_TIMEOUT_MS there, default 5s, capped at 15s); this is just a
// generous outer bound for the HTTP round trip so a hung network call can't
// wedge the calling request forever.
const REQUEST_TIMEOUT_MS = 20000;

export async function executeSandboxedCode(
  code: string,
  options: CodeSandboxOptions = {}
): Promise<CodeSandboxResult> {
  const start = Date.now();
  const serviceUrl = process.env.CODE_SANDBOX_SERVICE_URL;

  if (!serviceUrl) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      result: null,
      error:
        'Code execution is not configured on this deployment (CODE_SANDBOX_SERVICE_URL is unset). ' +
        'Deploy infra/sandbox-service and set that env var to enable the code_interpreter tool.',
      exitReason: 'runtime_error',
      durationMs: Date.now() - start,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.CODE_SANDBOX_SERVICE_SECRET
          ? { 'x-sandbox-secret': process.env.CODE_SANDBOX_SERVICE_SECRET }
          : {}),
      },
      body: JSON.stringify({ code, language: options.language ?? 'javascript' }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        result: null,
        error: `Sandbox service returned HTTP ${response.status}.`,
        exitReason: 'runtime_error',
        durationMs: Date.now() - start,
      };
    }

    return (await response.json()) as CodeSandboxResult;
  } catch (err) {
    const message = (err as Error)?.message || String(err);
    const timedOut = (err as Error)?.name === 'AbortError';
    return {
      success: false,
      stdout: '',
      stderr: '',
      result: null,
      error: timedOut ? 'Sandbox service request timed out.' : `Sandbox service request failed: ${message}`,
      exitReason: timedOut ? 'timeout' : 'runtime_error',
      durationMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timer);
  }
}
