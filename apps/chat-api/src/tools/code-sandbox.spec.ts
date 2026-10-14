import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeSandboxedCode } from './code-sandbox';

describe('executeSandboxedCode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CODE_SANDBOX_SERVICE_URL;
  });

  function stubSandbox() {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ success: true, stdout: '', stderr: '', result: 2, exitReason: 'completed', durationMs: 1 }), {
          status: 200,
        });
      })
    );
    return urls;
  }

  it('reports the tool as unavailable when no sandbox URL is bound or set', async () => {
    const result = await executeSandboxedCode('return 1 + 1;');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/CODE_SANDBOX_SERVICE_URL is unset/);
  });

  it.each([
    ['https://sandbox.internal', 'https://sandbox.internal/execute'],
    ['https://sandbox.internal/', 'https://sandbox.internal/execute'],
    // A binding URL that carries its own path prefix keeps it.
    ['https://host.internal/svc/sandbox', 'https://host.internal/svc/sandbox/execute'],
  ])('posts to /execute under the bound base URL %s', async (base, expected) => {
    const urls = stubSandbox();
    process.env.CODE_SANDBOX_SERVICE_URL = base;
    const result = await executeSandboxedCode('return 1 + 1;');
    expect(result.success).toBe(true);
    expect(urls).toEqual([expected]);
  });
});
