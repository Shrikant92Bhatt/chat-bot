# Enterprise AI Chat Monorepo - Market Standard Guidelines

## Architecture Overview
This repository is an enterprise-grade **Nx Monorepo** containing:
- **`apps/chat-client`**: Angular 18 Standalone Components + Signals, Tailwind CSS (Glassmorphism & Neumorphism UI).
- **`apps/chat-api`**: Node.js + Express TypeScript backend with Google OAuth2 middleware and multi-LLM SSE streaming router (Google Gemini & OpenAI).
- **`libs/shared`**: Shared DTOs and interfaces (`@chat-monorepo/shared`).

---

## Coding Standards & Rules

### 1. Frontend (Angular 18)
- **Standalone Components Only**: All components must be standalone (`standalone: true`).
- **Signals State Management**: Use `signal()`, `computed()`, and `writable()` for reactive state management.
- **Glassmorphism Styling**: Use frosted glass panels (`backdrop-blur-md bg-white/5 border border-white/10`), obsidian dark theme tokens, and `[ngClass]` for dynamic class bindings to prevent HTML parser errors.
- **SSE Stream Consumption**: Use standard `fetch` with `ReadableStream` for parsing `data:` chunks from the backend.

### 2. Backend (Node.js Express)
- **Google OAuth2 Middleware**: All protected endpoints under `/api/chat/*` validate Google ID Tokens passed via `Authorization: Bearer` headers.
- **Multi-LLM Router**: `AIRouterService` dynamically dispatches streaming requests to Google Gemini (`@google/generative-ai`) or OpenAI (`openai`).
- **Extension Adapters**: Keep MCP (`mcp.adapter.ts`), RAG (`rag.adapter.ts`), and Vector DB (`vector-db.adapter.ts`) decoupled for future enhancements.

### 3. Build & DevOps Standard
- **Parallel Start**: Use `npm start` (`nx run-many -t serve --parallel=2`) for local dev.
- **Build Verification**: Run `npx nx run-many -t build` to ensure 100% compilation across all apps and shared libraries.
- **Docker Containers**:
  - `Dockerfile.api`: Node.js 20 LTS multi-stage production image for Express backend.
  - `Dockerfile.client`: Multi-stage build with NGINX (`nginx:alpine`) for Angular SPA static asset hosting and client-side routing fallback.

### 4. Git Branching & Workflow Rules
- **No Direct Push to `main`**: Never push changes directly to `main`.
- **Sensible Branch Naming**: Always use clear, descriptive, meaningful branch names reflecting the feature or fix (e.g., `feat/google-oauth-gcp-deploy`), rather than generic branch names.
- **Single Active Branch**: Consolidate ongoing updates on the active descriptive working branch.
- **PR Creation**: Only generate or present Pull Request links when explicitly requested by the user ("create pr").
