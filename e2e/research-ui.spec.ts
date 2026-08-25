import { test, expect } from '@playwright/test';

/**
 * Renders scripted research turns so the thinking panel and citations can
 * be verified without a live gateway.
 *
 * Two things here are regression tests rather than new coverage: sources
 * used to be passed only into the UI card component and rendered only when
 * that component was shown, so a prose answer with citations dropped every
 * link; and the research trace was invisible entirely, leaving the user
 * watching an idle spinner through the whole planning and search phase.
 */

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
};

const MODEL = 'gemini-flash-latest';

function frame(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ done: false, model: MODEL, ...payload })}\n\n`;
}

function sse(events: Array<Record<string, unknown>>): string {
  return events.map(frame).join('');
}

async function sendMessage(page: import('@playwright/test').Page, text: string) {
  const box = page.locator('textarea[name="messageText"]');
  await expect(box).toBeVisible({ timeout: 20000 });
  await box.fill(text);
  await box.press('Enter');
}

test.describe('Research panel', () => {
  test('records the plan and each query outcome, including one still in flight', async ({ page }) => {
    await page.route('**/api/chat/stream', async (route) => {
      await route.fulfill({
        headers: SSE_HEADERS,
        body: sse([
          { research: { type: 'research_status', phase: 'thinking', message: 'Checking whether this needs live data' } },
          {
            research: {
              type: 'research_plan',
              needsResearch: true,
              reasoning: 'Need current Nifty levels and liquid ETF data.',
              searchQueries: ['Nifty 50 levels today', 'Most liquid NSE ETFs', 'Bank Nifty support levels'],
            },
          },
          { research: { type: 'research_query_start', query: 'Nifty 50 levels today', index: 0, total: 3 } },
          { research: { type: 'research_query_done', query: 'Nifty 50 levels today', index: 0, ok: true, citationCount: 3 } },
          { research: { type: 'research_query_start', query: 'Most liquid NSE ETFs', index: 1, total: 3 } },
          { research: { type: 'research_query_done', query: 'Most liquid NSE ETFs', index: 1, ok: false } },
          // Index 2 is deliberately left mid-flight, so the panel has to
          // render all three states at once.
          { research: { type: 'research_query_start', query: 'Bank Nifty support levels', index: 2, total: 3 } },
          { chunk: 'The Nifty 50 closed at 24,850.' },
          { done: true },
        ]),
      });
    });

    await page.goto('/');
    await sendMessage(page, 'nifty outlook today');

    await expect(page.locator('.markdown-body', { hasText: 'The Nifty 50 closed at 24,850.' })).toBeVisible({ timeout: 20000 });

    // Expand: the trace survives the turn, which is what makes an answer
    // auditable after the fact rather than only while it streams.
    await page.getByRole('button', { name: /Thinking/ }).click();

    await expect(page.getByText('Need current Nifty levels and liquid ETF data.')).toBeVisible();
    await expect(page.getByText('Searches (3)')).toBeVisible();

    for (const query of ['Nifty 50 levels today', 'Most liquid NSE ETFs', 'Bank Nifty support levels']) {
      await expect(page.getByText(query, { exact: false })).toBeVisible();
    }

    // The succeeded query reports what it found; the failed one is marked
    // rather than quietly omitted.
    await expect(page.getByText('3 sources')).toBeVisible();
    await expect(page.locator('text=✕')).toBeVisible();
    await expect(page.locator('text=✓')).toBeVisible();
  });

  test('collapses to a summary once the answer arrives, and keeps the sources', async ({ page }) => {
    await page.route('**/api/chat/stream', async (route) => {
      await route.fulfill({
        headers: SSE_HEADERS,
        body: sse([
          {
            research: {
              type: 'research_plan',
              needsResearch: true,
              reasoning: 'Need current levels.',
              searchQueries: ['Nifty 50 levels today'],
            },
          },
          {
            research: {
              type: 'research_sources',
              sources: [
                { url: 'https://www.moneycontrol.com/markets/nifty', title: 'Nifty ends higher' },
                { url: 'https://economictimes.indiatimes.com/markets' },
              ],
            },
          },
          { chunk: 'The Nifty 50 closed at 24,850.' },
          { done: true },
        ]),
      });
    });

    await page.goto('/');
    await sendMessage(page, 'nifty outlook today');

    await expect(page.locator('.markdown-body', { hasText: 'The Nifty 50 closed at 24,850.' })).toBeVisible({ timeout: 20000 });

    // Collapsed: the reasoning is hidden, but the panel still summarises.
    await expect(page.getByText('Need current levels.')).toHaveCount(0);
    const header = page.getByRole('button', { name: /Thinking/ });
    await expect(header).toBeVisible();
    await expect(header).toContainText('1 search');
    await expect(header).toContainText('2 sources');

    // Reopening it brings back the detail, including working links.
    await header.click();
    await expect(page.getByText('Need current levels.')).toBeVisible();

    const titled = page.locator('a[href="https://www.moneycontrol.com/markets/nifty"]');
    await expect(titled).toBeVisible();
    await expect(titled).toContainText('Nifty ends higher');
    await expect(titled).toHaveAttribute('target', '_blank');
    await expect(titled).toHaveAttribute('rel', /noopener/);

    // No title supplied, so the chip falls back to a bare hostname rather
    // than an unreadable full URL.
    await expect(page.locator('a[href="https://economictimes.indiatimes.com/markets"]')).toContainText(
      'economictimes.indiatimes.com'
    );
  });

  test('says why it skipped research instead of hiding the panel', async ({ page }) => {
    await page.route('**/api/chat/stream', async (route) => {
      await route.fulfill({
        headers: SSE_HEADERS,
        body: sse([
          {
            research: {
              type: 'research_status',
              phase: 'skipped',
              message: 'No live-data signal in this question — answering directly.',
            },
          },
          { chunk: 'Use const by default.' },
          { done: true },
        ]),
      });
    });

    await page.goto('/');
    await sendMessage(page, 'let vs const');

    await expect(page.locator('.markdown-body', { hasText: 'Use const by default.' })).toBeVisible({ timeout: 20000 });

    const header = page.getByRole('button', { name: /Thinking/ });
    await expect(header).toContainText('answering directly');
  });

  test('stays out of the way on a turn with no research at all', async ({ page }) => {
    await page.route('**/api/chat/stream', async (route) => {
      await route.fulfill({
        headers: SSE_HEADERS,
        body: sse([{ chunk: 'Use const by default.' }, { done: true }]),
      });
    });

    await page.goto('/');
    await sendMessage(page, 'let vs const');

    await expect(page.locator('.markdown-body', { hasText: 'Use const by default.' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: /Thinking/ })).toHaveCount(0);
  });
});
