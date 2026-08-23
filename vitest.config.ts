import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'vite.config.ts',
      'libs/frontend/admin-analytics/vite.config.mts',
    ],
  },
});
