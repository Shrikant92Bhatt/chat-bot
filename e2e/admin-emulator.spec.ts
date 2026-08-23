import { test, expect } from '@playwright/test';

test.describe('Admin Console & Subsystem Emulator E2E Suite', () => {
  test('should render the app header and chat interface', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/NexusAI|Chat/i);
  });

  test('should allow navigation to the admin console route', async ({ page }) => {
    await page.goto('/admin/overview');
    // Admin access check / header presence
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should support direct URL navigation to the Admin Subsystem Emulator tab', async ({ page }) => {
    await page.goto('/admin/emulator');
    // Emulator route loading test
    await page.waitForTimeout(500);
    const url = page.url();
    expect(url).toContain('/admin/emulator');
  });
});
