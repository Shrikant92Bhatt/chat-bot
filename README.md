# Enterprise AI Monorepo Chat Application (NexusAI)

An enterprise-grade AI Chat Application built as an **Nx Monorepo**, featuring Angular 18 Standalone components with Glassmorphism UI, an Express Node.js backend with multi-LLM SSE streaming (Gemini & OpenAI), Firebase Google Authentication, and automated GCP CI/CD deployment configuration.

---

## 🏗 Repository Structure

```
.
├── apps/
│   ├── chat-client/               # Angular 18 Standalone + Tailwind Glassmorphism UI
│   │   ├── src/app/
│   │   │   ├── components/        # Navbar, Sidebar, ChatWindow, MessageInput
│   │   │   └── services/          # AuthService (Firebase), ChatService (SSE Stream)
│   │   └── tailwind.config.js     # Glassmorphism/Obsidian design system
│   └── chat-api/                  # Node.js + Express Backend Service
│       └── src/
│           ├── middleware/        # Firebase Auth ID Token verification
│           ├── services/          # Multi-LLM Stream Router (Gemini & OpenAI)
│           ├── adapters/          # MCP, RAG, and Vector DB Extension Stubs
│           └── main.ts
├── libs/
│   └── shared/                    # Shared DTOs, TypeScript interfaces, and types
├── Dockerfile.api                 # Multi-stage Node.js LTS Dockerfile
├── cloudbuild.yaml                # GCP Cloud Build deployment to Cloud Run
├── nx.json                        # Nx workspace task pipeline configuration
├── tsconfig.base.json             # Root TypeScript path mapping (@chat-monorepo/shared)
└── package.json
```

---

## ⚡ Key Features

1. **Modern Glassmorphism & Neumorphism Aesthetics**:
   - Obsidian dark theme with frosted glass panels (`backdrop-blur-md bg-white/5 border border-white/10`).
   - Glowing ambient backdrop effects, smooth layout transitions, and model-switch toggle.

2. **Unified Multi-LLM Router & SSE Streaming**:
   - Integrated with `@google/genai` (Gemini 1.5 Pro / Flash) and `openai` (GPT-4o / GPT-4o-mini).
   - Real-time Server-Sent Events (SSE) stream processing on both API and Angular frontend.

3. **Google Sign-In Authentication**:
   - Firebase Auth / Google Identity Provider on frontend.
   - Verified via Express Bearer token middleware on the backend (`auth.middleware.ts`).

4. **Future-Proof Adapters**:
   - Clean directory interfaces for **MCP** (Model Context Protocol), **RAG**, and **Vector DBs** (Pinecone, Qdrant).

5. **GCP DevOps Ready**:
   - Multi-stage Node.js 20 LTS `Dockerfile.api`.
   - GCP Cloud Build pipeline (`cloudbuild.yaml`) targeting GCP Cloud Run.

---

## 🚀 Quick Start

### 1. Installation
```bash
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Provide your API keys:
- `GEMINI_API_KEY`: Your Google Gemini API Key.
- `OPENAI_API_KEY`: Your OpenAI API Key.

### 3. Running Locally (Parallel Single Command)
Run both backend Express API and Angular Frontend concurrently with one command:
```bash
npm start
```
*(Or `npm run dev`)*

This leverages Nx's parallel task runner (`nx run-many -t serve --parallel=2`):
- **Backend API**: Running on `http://localhost:3000`
- **Angular Client**: Running on `http://localhost:4200`

---

## 🐳 Docker & GCP Cloud Run Deployment

Build local container image:
```bash
docker build -t chat-api -f Dockerfile.api .
docker run -p 8080:8080 -e GEMINI_API_KEY="your_key" chat-api
```

Deploy to GCP Cloud Run using Cloud Build:
```bash
gcloud builds submit --config=cloudbuild.yaml
```
