# Playwright E2E Testing Operations Skill

## 1. Environment & Configuration
- **Config**: [`playwright.config.ts`](file:///c:/Users/bhatt/Desktop/Work/AI/chat-bot/playwright.config.ts)
- **Spec Directory**: `e2e/*.spec.ts`
- **Base URL**: `http://localhost:4200` (chat-client)

## 2. Command Reference
- Run all E2E tests:
  ```bash
  npx playwright test
  ```
- Run tests in UI mode:
  ```bash
  npx playwright test --ui
  ```
- Inspect HTML test report:
  ```bash
  npx playwright show-report
  ```

## 3. Best Practices for Chat & Admin E2E Tests
- Use explicit page routing assertions (`await expect(page).toHaveURL(/.../)`).
- Test standalone components without relying on volatile DOM classes.
- Validate network SSE stream boundaries for chat and admin emulator streaming.
