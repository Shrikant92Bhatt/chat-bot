# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-session.spec.ts >> Google OAuth2 & Session Exchange Authentication E2E Suite >> should reject invalid or missing Bearer token on POST /api/auth/session with 401 JSON
- Location: e2e\auth-session.spec.ts:13:7

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 401
Received: 404
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Google OAuth2 & Session Exchange Authentication E2E Suite', () => {
  4  |   test('should verify GET /api/auth/session returns JSON service health', async ({ request }) => {
  5  |     const response = await request.get('/api/auth/session');
  6  |     expect(response.status()).toBe(200);
  7  | 
  8  |     const json = await response.json();
  9  |     expect(json.status).toBe('active');
  10 |     expect(json.service).toContain('NexusAI Auth Session API');
  11 |   });
  12 | 
  13 |   test('should reject invalid or missing Bearer token on POST /api/auth/session with 401 JSON', async ({ request }) => {
  14 |     const response = await request.post('/api/auth/session', {
  15 |       headers: {
  16 |         'Content-Type': 'application/json',
  17 |       },
  18 |     });
  19 | 
> 20 |     expect(response.status()).toBe(401);
     |                               ^ Error: expect(received).toBe(expected) // Object.is equality
  21 |     const json = await response.json();
  22 |     expect(json.error).toBe('Unauthorized');
  23 |   });
  24 | 
  25 |   test('should render sign-in Google OAuth trigger button on UI', async ({ page }) => {
  26 |     await page.goto('/');
  27 |     const body = page.locator('body');
  28 |     await expect(body).toBeVisible();
  29 |   });
  30 | });
  31 | 
```