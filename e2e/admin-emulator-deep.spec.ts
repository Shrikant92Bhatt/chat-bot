import { test, expect } from '@playwright/test';

test.describe('Deep Subsystem & Emulator Interactive E2E Suite', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'NEXUS_AUTH_SESSION',
        JSON.stringify({
          uid: 'admin-test-uid',
          email: 'admin@example.com',
          displayName: 'Test Admin',
          photoURL: '',
          idToken: 'mock_e2e_session_token',
          role: 'admin',
        })
      );
    });
  });

  test('should open emulator tab, type query into test bench, and verify node state transition', async ({ page }) => {
    await page.goto('/admin/emulator');

    const adminBtn = page.locator('button[title="Admin console"]');
    if (await adminBtn.isVisible()) {
      await adminBtn.click();
    }

    const emulatorTab = page.locator('button', { hasText: 'Emulator' });
    await expect(emulatorTab).toBeVisible({ timeout: 15000 });
    await emulatorTab.click();

    // 1. Check title & layout presence
    await expect(page.locator('h1').filter({ hasText: 'Subsystem Orchestration Emulator' })).toBeVisible({ timeout: 15000 });

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
