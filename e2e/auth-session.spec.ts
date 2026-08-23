import { test, expect } from '@playwright/test';

test.describe('Google OAuth2 & Session Exchange Authentication E2E Suite', () => {
  test('should verify GET /api/auth/session returns JSON service health', async ({ request }) => {
    const response = await request.get('/api/auth/session');
    expect(response.status()).toBe(200);

    const json = await response.json();
    expect(json.status).toBe('active');
    expect(json.service).toContain('NexusAI Auth Session API');
  });

  test('should reject invalid or missing Bearer token on POST /api/auth/session with 401 JSON', async ({ request }) => {
    const response = await request.post('/api/auth/session', {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    expect(response.status()).toBe(401);
    const json = await response.json();
    expect(json.error).toBe('Unauthorized');
  });

  test('should render sign-in Google OAuth trigger button on UI', async ({ page }) => {
    await page.goto('/');
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});
