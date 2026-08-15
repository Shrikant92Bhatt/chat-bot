---
name: nx-ai-chat-ops
description: Market-standard operational runbook and skill for developing, building, containerizing, and deploying the enterprise Nx Monorepo AI Chat application.
---

# Nx Monorepo AI Chat Ops Skill

This skill provides step-by-step procedures for managing, testing, containerizing, and deploying the enterprise AI Chat application.

---

## 🛠 1. Monorepo Build & Development Commands

### Run Both Apps Concurrently (Parallel Mode)
```bash
npm start
```
Starts:
- `chat-api` backend on `http://localhost:3000`
- `chat-client` frontend on `http://localhost:4200`

### Build All Projects
```bash
npx nx run-many -t build
```
Compiles `libs/shared`, `apps/chat-api`, and `apps/chat-client`.

---

## 🐳 2. Production Containerization Runbook

### Build Express Backend Container
```bash
docker build -t chat-api:latest -f Dockerfile.api .
```

### Build Angular NGINX Frontend Container
```bash
docker build -t chat-client:latest -f Dockerfile.client .
```

---

## ☁️ 3. GCP Deployment Runbook

### Submit Build to GCP Cloud Build & Cloud Run
```bash
gcloud builds submit --config=cloudbuild.yaml
```

---

## 🔒 4. Environment Variables Checklist
Ensure `.env` contains:
- `GEMINI_API_KEY`: API key for Google Gemini Models.
- `OPENAI_API_KEY`: API key for OpenAI GPT Models.
- `FIREBASE_SERVICE_ACCOUNT_KEY`: (Optional) Firebase service account JSON for backend token validation.
