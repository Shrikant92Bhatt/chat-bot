import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/chat-api/src/**/*.spec.ts'],
  },
});
