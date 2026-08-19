// NOTE: isolated-vm's CJS export object exposes `Isolate`/`Context`/etc. via
// its prototype chain rather than as own enumerable properties, so
// `import * as ivm from 'isolated-vm'` (compiled with tslib's
// `__importStar`, which only copies *own* properties) silently drops them,
// leaving `ivm.Isolate` undefined at runtime with no compile-time warning.
// A default import goes through `__importDefault` instead, which preserves
// the whole original module object (and its prototype chain) untouched -
// confirmed working end-to-end against the compiled output.
import ivm from 'isolated-vm';
import * as ts from 'typescript';

/**
 * Sandboxed code execution backend for the `code_interpreter` MCP tool.
 *
 * ── Approach: isolated-vm (V8 isolate-level sandboxing) ──────────────────
 * Chosen over Node's `vm` module (which shares the host's V8 heap and is
 * explicitly documented as NOT a security boundary) and over shelling out to
 * a bare `child_process.fork` (which still runs full Node with `require`,
 * `fs`, `net` etc. available unless painstakingly stripped, and is heavier
 * per-invocation). isolated-vm gives each execution its own V8 Isolate with
 * its own heap, its own memory limit enforced by V8 itself, and a context
 * that starts with ZERO Node globals - no `require`, `process`, `fs`,
 * `fetch`, `net`, `XMLHttpRequest`. We only bridge in a `console` shim (see
 * below), so filesystem and network access aren't "blocked" by a denylist,
 * they simply never exist inside the sandbox scope. Verified locally
 * (`isolate.compileScript('typeof require + "," + typeof fetch')` ->
 * `"undefined,undefined"`, and `require('fs')` inside sandboxed code throws
 * `require is not defined`).
 *
 * Dependency-buildability (the reason this didn't fall back to `vm` +
 * child_process): isolated-vm@7 ships prebuilt native binaries
 * (`prebuilds/linux-x64/isolated-vm.abi147.musl.node`) that match this
 * project's runtime image (`node:24-alpine` in Dockerfile.api, which is
 * musl-based) as well as this dev machine (win32-x64). That means `npm ci`
 * in the Docker build stage does NOT need to compile a native addon
 * (no node-gyp / python3 / g++ toolchain required in the Alpine build
 * stage) - confirmed by installing the package here and loading it without
 * a compile step. If a future Node/OS combination lacks a prebuilt binary,
 * this is the first place to revisit.
 *
 * ── Isolation guarantees (what this IS and ISN'T) ─────────────────────────
 * - Process isolation: ISOLATE-level, not OS-process or container-level.
 *   Sandboxed code runs in a separate V8 Isolate (separate heap, separate
 *   microtask queue) inside the SAME OS process/container as the API
 *   server. Values crossing the boundary are explicitly copied/cloned, so
 *   sandboxed code cannot reach into host objects. This is meaningfully
 *   stronger than `vm.Script` (which shares the host heap) but weaker than
 *   a separate container/VM/gVisor sandbox - a V8 engine vulnerability
 *   could theoretically escape it. Cloud Run offers no Docker-in-Docker or
 *   privileged mode to run a heavier per-execution sandbox, so isolate-level
 *   is the strongest option available without standing up a dedicated
 *   executor microservice.
 * - Filesystem isolation: absolute, by omission. No `fs`/`require` handle is
 *   ever injected into the sandbox global scope.
 * - Network restriction: absolute, by omission. No `fetch`/`XMLHttpRequest`/
 *   `net`/`http` is ever injected.
 * - Memory limit: enforced by `new ivm.Isolate({ memoryLimit })` - V8 disposes
 *   the isolate automatically when the heap would exceed it (verified: a
 *   heap-growth loop is killed with "Isolate was disposed during execution
 *   due to memory limit").
 * - CPU/time limit: enforced two ways, and BOTH are required. `script.run()`
 *   accepts a `timeout` option, but testing showed it only bounds the
 *   *synchronous* execution phase - a script that `await`s a Promise that
 *   never resolves (e.g. `await new Promise(() => {})`) is NOT reliably
 *   aborted by `timeout` alone: the host-side awaited Promise can hang
 *   indefinitely, and in the worst case Node's event loop drains and the
 *   process exits while that await is still outstanding, silently
 *   abandoning the call. To close this gap, every execution is additionally
 *   raced against our own host-side `setTimeout` wall clock; when it fires
 *   we force `isolate.dispose()`, which terminates the isolate's execution
 *   outright and settles the race. No cgroup/CPU-share quota is configured
 *   beyond this wall clock - Cloud Run's own container-level CPU allocation
 *   is the outer bound.
 *
 * ── Language support ──────────────────────────────────────────────────────
 * JavaScript executes directly. TypeScript is transpiled to JS first via the
 * TypeScript compiler API (`ts.transpileModule`) - a syntax-only strip with
 * no type-checking, consistent with "make the snippet run" rather than
 * "type-check the model's code." `typescript` is already a workspace
 * devDependency; it ships in the production image too because
 * `Dockerfile.api`'s builder stage runs a plain `npm ci` (no `--omit=dev`)
 * before copying the whole `node_modules` into the runtime image.
 *
 * Python was scoped as a stretch goal (shell out to a locked-down `python3`
 * subprocess) but is NOT implemented: `node:24-alpine` has no `python3`
 * runtime by default, so this would require changing the Dockerfile to
 * install it plus separately plumbing OS-level resource limits (ulimit/
 * cgroups) for that subprocess - neither of which can be verified from this
 * environment. Left as a follow-up rather than attempted half-way.
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

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

// Hard caps: not overridable by tool input, only by server-side env config,
// so the calling model can never negotiate its way to a bigger sandbox.
const EXECUTION_TIMEOUT_MS = clamp(Number(process.env.CODE_SANDBOX_TIMEOUT_MS) || 5000, 500, 15000);
const MEMORY_LIMIT_MB = clamp(Number(process.env.CODE_SANDBOX_MEMORY_MB) || 64, 8, 128);
const MAX_OUTPUT_CHARS = 20000;
const MAX_CODE_LENGTH = 50000;

function stringifyConsoleArg(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function safeStringifyResult(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function transpileToJs(code: string, language: SandboxLanguage): string {
  if (language === 'javascript') return code;

  const output = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2020,
      removeComments: false,
      // The snippet runs standalone, not as part of a module graph.
      isolatedModules: false,
    },
    reportDiagnostics: false,
  });
  return output.outputText;
}

/**
 * Executes a JavaScript/TypeScript snippet inside an isolated V8 Isolate
 * with a memory limit and a wall-clock + isolate-level timeout. The snippet
 * body is wrapped in an async IIFE, so `return <expr>;` at the top level
 * works the way it would in a REPL/notebook cell.
 */
export async function executeSandboxedCode(
  code: string,
  options: CodeSandboxOptions = {}
): Promise<CodeSandboxResult> {
  const start = Date.now();
  const language = options.language ?? 'javascript';

  if (typeof code !== 'string' || code.trim().length === 0) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      result: null,
      error: 'No code was provided.',
      exitReason: 'compile_error',
      durationMs: Date.now() - start,
    };
  }

  if (code.length > MAX_CODE_LENGTH) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      result: null,
      error: `Code exceeds the maximum allowed length of ${MAX_CODE_LENGTH} characters.`,
      exitReason: 'compile_error',
      durationMs: Date.now() - start,
    };
  }

  let jsCode: string;
  try {
    jsCode = transpileToJs(code, language);
  } catch (err) {
    return {
      success: false,
      stdout: '',
      stderr: '',
      result: null,
      error: `Compile error: ${(err as Error).message}`,
      exitReason: 'compile_error',
      durationMs: Date.now() - start,
    };
  }

  const stdout: string[] = [];
  const stderr: string[] = [];
  let outputChars = 0;
  let outputTruncated = false;

  const capture = (bucket: string[], parts: unknown[]) => {
    if (outputTruncated) return;
    const line = parts.map(stringifyConsoleArg).join(' ');
    outputChars += line.length;
    if (outputChars > MAX_OUTPUT_CHARS) {
      outputTruncated = true;
      bucket.push('...[output truncated]');
      return;
    }
    bucket.push(line);
  };

  let isolate: ivm.Isolate | undefined;
  let timer: NodeJS.Timeout | undefined;

  try {
    isolate = new ivm.Isolate({ memoryLimit: MEMORY_LIMIT_MB });
    const context = await isolate.createContext();
    const jail = context.global;
    await jail.set('global', jail.derefInto());

    const logRef = new ivm.Reference((...args: unknown[]) => capture(stdout, args));
    const errRef = new ivm.Reference((...args: unknown[]) => capture(stderr, args));
    await jail.set('__log', logRef);
    await jail.set('__err', errRef);

    await context.eval(
      `
      const console = Object.freeze({
        log: (...args) => __log.applySync(undefined, args, { arguments: { copy: true } }),
        info: (...args) => __log.applySync(undefined, args, { arguments: { copy: true } }),
        warn: (...args) => __err.applySync(undefined, args, { arguments: { copy: true } }),
        error: (...args) => __err.applySync(undefined, args, { arguments: { copy: true } }),
      });
      `,
      { timeout: EXECUTION_TIMEOUT_MS }
    );

    const wrapped = `(async function() {\n${jsCode}\n})()`;
    const script = await isolate.compileScript(wrapped, { filename: 'user-code.js' });

    // See top-of-file comment: the isolate's own `timeout` option does not
    // reliably bound a script whose returned promise never settles, so we
    // race it against our own wall clock and force-dispose on expiry.
    const capturedIsolate = isolate;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (!capturedIsolate.isDisposed) capturedIsolate.dispose();
        reject(new Error('Execution timed out (wall clock).'));
      }, EXECUTION_TIMEOUT_MS);
    });

    const rawResult = await Promise.race([
      script.run(context, { timeout: EXECUTION_TIMEOUT_MS, promise: true, copy: true }),
      timeoutPromise,
    ]);

    return {
      success: true,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
      result: safeStringifyResult(rawResult),
      error: null,
      exitReason: 'completed',
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const message = (err as Error)?.message || String(err);
    let exitReason: SandboxExitReason = 'runtime_error';
    if (/timed out/i.test(message)) exitReason = 'timeout';
    else if (/memory limit|isolate is disposed/i.test(message)) exitReason = 'memory_limit';
    else if (/^unexpected |^syntaxerror/i.test(message)) {
      // V8 parse errors from isolate.compileScript() surface as thrown
      // errors starting with "Unexpected ..." (e.g. "Unexpected identifier"),
      // distinct from a runtime ReferenceError like "require is not defined"
      // which legitimately belongs under 'runtime_error'.
      exitReason = 'compile_error';
    }

    return {
      success: false,
      stdout: stdout.join('\n'),
      stderr: stderr.join('\n'),
      result: null,
      error: message,
      exitReason,
      durationMs: Date.now() - start,
    };
  } finally {
    if (timer) clearTimeout(timer);
    if (isolate && !isolate.isDisposed) {
      isolate.dispose();
    }
  }
}
