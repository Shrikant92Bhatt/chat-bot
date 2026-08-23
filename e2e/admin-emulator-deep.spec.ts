import { test, expect } from '@playwright/test';

test.describe('Deep Subsystem & Emulator Interactive E2E Suite', () => {
  test('should open emulator tab, type query into test bench, and verify node state transition', async ({ page }) => {
    await page.goto('/admin/emulator');

    // 1. Check title & layout presence
    await expect(page.locator('h1')).toContainText('Subsystem Orchestration Emulator');

    // 2. Locate Test Bench Input and submit test query
    const input = page.locator('input[placeholder*="Type any test query"]');
    await expect(input).toBeVisible();

    await input.fill('Calculate 15 * 8 and search latest quantum computing news');

    // 3. Trigger emulation run button
    const simulateButton = page.locator('button:has-text("Simulate Pipeline")');
    await expect(simulateButton).toBeEnabled();
    await simulateButton.click();

    // 4. Verify running state transition
    await expect(page.locator('button:has-text("Running Pipeline")')).toBeVisible({ timeout: 2000 });

    // 5. Verify stage completion node update
    await expect(simulateButton).toBeEnabled({ timeout: 15000 });

    // 6. Inspect Payload details drawer
    const inspector = page.locator('text=Stage Inspection');
    await expect(inspector).toBeVisible();
  });
});
