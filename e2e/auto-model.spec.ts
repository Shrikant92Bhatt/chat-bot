import { test, expect } from '@playwright/test';

/**
 * The Auto option in the model picker, which routes to OpenRouter's own
 * auto-router (`openrouter/auto`).
 *
 * Two things are worth pinning down: that Auto is offered and selectable,
 * and that a turn it serves is still attributable — handing the model
 * choice to OpenRouter is only reasonable if the user can see afterwards
 * what actually answered.
 */

const SSE_HEADERS = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' };

const MODELS_WITH_AUTO = {
  defaultModel: 'gemini-flash-latest',
  models: [
    { id: 'auto', name: 'Auto', provider: 'Automatic', description: 'Let OpenRouter pick', enabled: true },
    {
      id: 'gemini-flash-latest',
      name: 'Gemini Flash',
      provider: 'Google',
      enabled: true,
      pricing: { prompt: 0.00015, completion: 0.0006 },
    },
  ],
};

async function openModelPicker(page: import('@playwright/test').Page) {
  const trigger = page.locator('button[aria-label="Select model"]');
  await expect(trigger).toBeVisible({ timeout: 20000 });
  await trigger.click();
  await expect(page.locator('[role="listbox"]')).toBeVisible();
}

test.describe('Auto model', () => {
  test('is offered in the picker with no cost badge', async ({ page }) => {
    await page.route('**/api/chat/models*', (route) =>
      route.fulfill({ json: MODELS_WITH_AUTO })
    );

    await page.goto('/');
    await openModelPicker(page);

    const autoOption = page.locator('[role="option"]', { hasText: 'Auto' });
    await expect(autoOption).toBeVisible();

    // Auto's cost depends on what it routes to, so it must not claim a
    // Low/Med/High tier the way a fixed-price model does.
    await expect(autoOption.locator('text=/^(Low|Med|High)$/')).toHaveCount(0);
    // A priced model alongside it still shows its badge, proving the
    // absence above is about Auto and not a broken badge renderer.
    await expect(page.locator('[role="option"]', { hasText: 'Gemini Flash' }).getByText('Low')).toBeVisible();
  });

  test('selecting Auto sends model "auto" to the backend', async ({ page }) => {
    await page.route('**/api/chat/models*', (route) => route.fulfill({ json: MODELS_WITH_AUTO }));

    let sentModel: string | undefined;
    await page.route('**/api/chat/stream', async (route) => {
      sentModel = route.request().postDataJSON()?.model;
      await route.fulfill({
        headers: SSE_HEADERS,
        body:
          `data: ${JSON.stringify({ chunk: 'Routed reply.', done: false, model: 'auto' })}\n\n` +
          `data: ${JSON.stringify({ chunk: '', done: true, model: 'auto', servedModel: 'anthropic/claude-sonnet-4.5' })}\n\n`,
      });
    });

    await page.goto('/');
    await openModelPicker(page);
    await page.locator('[role="option"]', { hasText: 'Auto' }).click();

    const box = page.locator('textarea[name="messageText"]');
    await box.fill('hello');
    await box.press('Enter');

    await expect(page.locator('.markdown-body', { hasText: 'Routed reply.' })).toBeVisible({ timeout: 20000 });
    expect(sentModel).toBe('auto');
  });

  test('attributes the reply to whichever model Auto picked', async ({ page }) => {
    await page.route('**/api/chat/models*', (route) => route.fulfill({ json: MODELS_WITH_AUTO }));
    await page.route('**/api/chat/stream', (route) =>
      route.fulfill({
        headers: SSE_HEADERS,
        body:
          `data: ${JSON.stringify({ chunk: 'Routed reply.', done: false, model: 'auto' })}\n\n` +
          `data: ${JSON.stringify({ chunk: '', done: true, model: 'auto', servedModel: 'anthropic/claude-sonnet-4.5' })}\n\n`,
      })
    );

    await page.goto('/');
    const box = page.locator('textarea[name="messageText"]');
    await expect(box).toBeVisible({ timeout: 20000 });
    await box.fill('hello');
    await box.press('Enter');

    await expect(page.locator('.markdown-body', { hasText: 'Routed reply.' })).toBeVisible({ timeout: 20000 });

    // The provider prefix is trimmed for display, but the full slug stays
    // available on hover.
    const chip = page.getByTitle('Auto routed this reply to anthropic/claude-sonnet-4.5');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('claude-sonnet-4.5');
  });

  test('shows no attribution chip on a normally-routed turn', async ({ page }) => {
    await page.route('**/api/chat/models*', (route) => route.fulfill({ json: MODELS_WITH_AUTO }));
    await page.route('**/api/chat/stream', (route) =>
      route.fulfill({
        headers: SSE_HEADERS,
        body:
          `data: ${JSON.stringify({ chunk: 'Direct reply.', done: false, model: 'gemini-flash-latest' })}\n\n` +
          `data: ${JSON.stringify({ chunk: '', done: true, model: 'gemini-flash-latest' })}\n\n`,
      })
    );

    await page.goto('/');
    const box = page.locator('textarea[name="messageText"]');
    await expect(box).toBeVisible({ timeout: 20000 });
    await box.fill('hello');
    await box.press('Enter');

    await expect(page.locator('.markdown-body', { hasText: 'Direct reply.' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByTitle(/Auto routed this reply/)).toHaveCount(0);
  });

  // The gateway guard itself (Auto is dropped from GET /models unless
  // OpenRouter is active) is covered in
  // apps/chat-api/src/services/model-config.auto.spec.ts. It is not
  // asserted here because reaching the live endpoint requires an API
  // process that a dev environment without Firestore credentials does not
  // reliably keep alive.
});
