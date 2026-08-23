import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npx tsx apps/chat-api/src/main.ts',
      url: 'http://localhost:3000/health',
      reuseExistingServer: false,
      timeout: 120 * 1000,
      env: {
        TS_NODE_PROJECT: 'tsconfig.base.json',
      },
    },
    {
      command: 'npx nx serve chat-client',
      url: 'http://localhost:4200',
      reuseExistingServer: false,
      timeout: 120 * 1000,
    },
  ],
});
