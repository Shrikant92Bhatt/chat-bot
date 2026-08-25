import { defineConfig } from 'vite';
import path from 'path';

/**
 * chat-client had no test runner wired up before this (no "test" target in
 * project.json, no spec files anywhere in the app - see git history). This
 * config is deliberately scoped to plain-TypeScript unit tests (pure
 * functions, no Angular TestBed/DOM rendering) - see
 * src/app/services/message-feedback.util.spec.ts, the first thing it runs.
 * Exercising full Angular components would need the Angular compiler
 * wired into Vite (@analogjs/vite-plugin-angular, already a devDependency
 * but not yet configured here) plus a DOM environment - a larger, separate
 * effort intentionally left out of this change; see the PR description.
 */
export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      '@chat-monorepo/shared': path.resolve(__dirname, '../../libs/shared/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
