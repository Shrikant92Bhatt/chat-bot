import { Router, Response } from 'express';
import multer from 'multer';
import { authenticateToken, authenticateOrAllowTrial, AuthenticatedRequest } from '../middleware/auth.middleware';
import { AIRouterService } from '../services/ai-router.service';
import { UserRegistryService } from '../services/user-registry.service';
import { ThreadService } from '../services/thread.service';
import { isOpenAiConfigured } from '../services/openai.service';
import { ChatStreamRequest, ChatThread } from '@chat-monorepo/shared';
import { streamGraphResponse } from '../orchestration/graph';
import { StorageMetricsService } from '../storage/metrics';
import { generateImage } from '../llm/image-gen';
import { isOmniRouteConfigured } from '../llm/client';
import { extractDocumentText } from '../rag/document-extractor';
import { RagRetriever } from '../rag/retriever';
import { UsageService } from '../services/usage.service';
import { MemoryService } from '../memory/memory.service';
import { listPromptTemplates } from '../prompt/prompt-manager';
import { ModelConfigService } from '../services/model-config.service';

const router = Router();
const aiRouterService = new AIRouterService();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

/**
 * GET /api/chat/config
 * Public endpoint returning public Client ID configuration from backend .env
 */
router.get('/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    openAiConfigured: isOpenAiConfigured(),
  });
});

/**
 * POST /api/chat/stream
 * Handles SSE (Server-Sent Events) multi-LLM streaming responses.
 * Protected by Google ID Token middleware.
 */
router.post('/stream', authenticateOrAllowTrial, async (req: AuthenticatedRequest, res: Response) => {
  const { messages, model, temperature, mcpEnabled, ragContext, threadId, projectId } = req.body as ChatStreamRequest;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'Invalid request: "messages" array is required.' });
    return;
  }

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering

  const streamRequest: ChatStreamRequest = {
    messages,
    model: model || 'gemini-flash-latest',
    temperature: temperature ?? 0.7,
    mcpEnabled: mcpEnabled ?? false,
    ragContext,
    threadId,
    projectId: projectId ?? null,
  };

  try {
    try {
      await streamGraphResponse(streamRequest, res, req.user?.uid);
      return;
    } catch (graphError) {
      console.warn('[Chat API Route] LangGraph stream failed, falling back to AIRouterService', graphError);
      await aiRouterService.handleChatStream(streamRequest, res);
    }
  } catch (error) {
    console.error('[Chat API Route] Stream error:', error);
    res.write(`data: ${JSON.stringify({ error: (error as Error).message, done: true })}\n\n`);
    res.end();
  }
});

/**
 * GET /api/chat/models
 * Returns dynamically configured enabled models and default model.
 */
router.get('/models', authenticateOrAllowTrial, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const config = await ModelConfigService.getModelConfig();
    const enabledModels = config.models.filter((m) => m.enabled !== false);
    res.json({
      defaultModel: config.defaultModel,
      models: enabledModels.length > 0 ? enabledModels : config.models,
    });
  } catch (error) {
    console.error('[Chat API Route] Failed to load model config:', error);
    res.status(500).json({ error: 'Failed to load models.' });
  }
});

/**
 * GET /api/chat/users
 * Returns list of authenticated application users.
 */
router.get('/users', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const users = await UserRegistryService.getAllUsers();
    res.json({ users, count: users.length });
  } catch (error) {
    console.error('[Chat API Route] Failed to load users:', error);
    res.status(500).json({ error: 'Failed to load users.' });
  }
});

/**
 * GET /api/chat/threads
 * Returns all saved chat threads for the authenticated user.
 */
router.get('/threads', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const threads = await ThreadService.getThreadsForUser(req.user!.uid);
    res.json({ threads });
  } catch (error) {
    console.error('[Chat API Route] Failed to load threads:', error);
    res.status(500).json({ error: 'Failed to load chat threads.' });
  }
});

/**
 * PUT /api/chat/threads
 * Replaces the authenticated user's full thread list (mirrors the
 * "save the whole array" pattern the frontend already uses).
 */
router.put('/threads', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const threads = req.body?.threads as ChatThread[] | undefined;

  if (!Array.isArray(threads)) {
    res.status(400).json({ error: 'Invalid request: "threads" array is required.' });
    return;
  }

  try {
    await ThreadService.saveThreadsForUser(req.user!.uid, threads);
    res.json({ success: true });
  } catch (error) {
    console.error('[Chat API Route] Failed to save threads:', error);
    res.status(500).json({ error: 'Failed to save chat threads.' });
  }
});

/**
 * GET /api/chat/storage/metrics
 */
router.get('/storage/metrics', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const metricsService = new StorageMetricsService();
    const metrics = await metricsService.getBucketMetrics();
    res.json(metrics);
  } catch (error) {
    console.error('[Chat API Route] Storage metrics error:', error);
    res.status(500).json({ error: 'Failed to fetch storage metrics.' });
  }
});

/**
 * POST /api/chat/generate-image
 */
router.post('/generate-image', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required.' });
      return;
    }

    const { imageUrl } = await generateImage(prompt);
    res.json({ success: true, imageUrl, prompt });
  } catch (error) {
    console.error('[Chat API Route] Image generation error:', error);
    res.status(500).json({ error: 'Failed to generate image.' });
  }
});

/**
 * POST /api/chat/documents
 * Uploads a file (.txt, .md, .csv, .json, .pdf) into the authenticated
 * user's RAG knowledge base - future chat turns automatically get
 * relevant excerpts injected as context (see RagRetriever.retrieveContext,
 * called from orchestration/graph.ts).
 */
router.post('/documents', authenticateToken, upload.single('file'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'No file was uploaded (expected multipart field "file").' });
      return;
    }

    const text = await extractDocumentText(file.buffer, file.originalname, file.mimetype);

    const ragRetriever = new RagRetriever();
    const docId = `doc-${Date.now()}-${file.originalname}`;
    await ragRetriever.ingest(docId, req.user!.uid, text, { fileName: file.originalname });

    res.json({ success: true, fileName: file.originalname, characters: text.length });
  } catch (error) {
    console.error('[Chat API Route] Document upload error:', error);
    res.status(400).json({ error: (error as Error).message || 'Failed to process document.' });
  }
});

/**
 * GET /api/chat/usage
 * Returns the authenticated user's most recent usage/cost records (token
 * counts + estimated cost per completed chat request). See
 * services/usage.service.ts - inputTokens/outputTokens/estimatedCostUsd
 * are null on records where the gateway didn't return real usage data
 * (never fabricated).
 */
router.get('/usage', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const records = await UsageService.getRecentUsageForUser(req.user!.uid, limit);
    res.json({ records, count: records.length });
  } catch (error) {
    console.error('[Chat API Route] Failed to load usage records:', error);
    res.status(500).json({ error: 'Failed to load usage records.' });
  }
});

/**
 * GET /api/chat/memories
 * The durable facts/preferences the assistant has saved about this user.
 * Written automatically by the memory extractor after a turn (see
 * context/context-builder.ts -> MemoryService.rememberFromMessage); this
 * endpoint exists so a user can see and prune them.
 */
router.get('/memories', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const memories = await MemoryService.listMemories(req.user!.uid);
    res.json({ memories });
  } catch (error) {
    console.error('[Chat API Route] Failed to load memories:', error);
    res.status(500).json({ error: 'Failed to load memories.' });
  }
});

/** DELETE /api/chat/memories/:id */
router.delete('/memories/:id', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deleted = await MemoryService.deleteMemory(req.user!.uid, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Memory not found.' });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[Chat API Route] Failed to delete memory:', error);
    res.status(500).json({ error: 'Failed to delete memory.' });
  }
});

/**
 * GET /api/chat/prompts
 * The versioned prompt registry (keys + descriptions, not the raw template
 * bodies) — lets the Diagnostics UI show which prompt versions are live.
 */
router.get('/prompts', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json({ templates: listPromptTemplates() });
});

export default router;
