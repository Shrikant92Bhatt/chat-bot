# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: admin-emulator-deep.spec.ts >> Deep Subsystem & Emulator Interactive E2E Suite >> should open emulator tab, type query into test bench, and verify node state transition
- Location: e2e\admin-emulator-deep.spec.ts:4:7

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4200/admin/emulator
Call log:
  - navigating to "http://localhost:4200/admin/emulator", waiting until "load"

```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Deep Subsystem & Emulator Interactive E2E Suite', () => {
  4  |   test('should open emulator tab, type query into test bench, and verify node state transition', async ({ page }) => {
> 5  |     await page.goto('/admin/emulator');
     |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4200/admin/emulator
  6  | 
  7  |     // 1. Check title & layout presence
  8  |     await expect(page.locator('h1')).toContainText('Subsystem Orchestration Emulator');
  9  | 
  10 |     // 2. Locate Test Bench Input and submit test query
  11 |     const input = page.locator('input[placeholder*="Type any test query"]');
  12 |     await expect(input).toBeVisible();
  13 | 
  14 |     await input.fill('Calculate 15 * 8 and search latest quantum computing news');
  15 | 
  16 |     // 3. Trigger emulation run button
  17 |     const simulateButton = page.locator('button:has-text("Simulate Pipeline")');
  18 |     await expect(simulateButton).toBeEnabled();
  19 |     await simulateButton.click();
  20 | 
  21 |     // 4. Verify running state transition
  22 |     await expect(page.locator('button:has-text("Running Pipeline")')).toBeVisible({ timeout: 2000 });
  23 | 
  24 |     // 5. Verify stage completion node update
  25 |     await expect(simulateButton).toBeEnabled({ timeout: 15000 });
  26 | 
  27 |     // 6. Inspect Payload details drawer
  28 |     const inspector = page.locator('text=Stage Inspection');
  29 |     await expect(inspector).toBeVisible();
  30 |   });
  31 | });
  32 | 
```