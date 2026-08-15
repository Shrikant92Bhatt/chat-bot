import dotenv from 'dotenv';
import path from 'path';

/**
 * Loads environment variables before any other module is imported.
 * Must be the first import in main.ts: TS-compiled `import` statements
 * become CommonJS `require()` calls executed in source order, so anything
 * imported before this file (e.g. chat.routes -> AIRouterService ->
 * GeminiService) would otherwise read process.env before it's populated,
 * since module-scope code runs at import time.
 *
 * .env.local is gitignored and holds real local secrets, so it's loaded
 * last with override so it wins over any committed .env defaults.
 */
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: true });
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local'), override: true });
