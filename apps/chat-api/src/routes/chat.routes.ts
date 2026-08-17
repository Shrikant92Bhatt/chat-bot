import { Router, Response } from 'express';
import { authenticateToken, authenticateOrAllowTrial, AuthenticatedRequest } from '../middleware/auth.middleware';
import { AIRouterService } from '../services/ai-router.service';
import { UserRegistryService } from '../services/user-registry.service';
import { ThreadService } from '../services/thread.service';
import { isOpenAiConfigured } from '../services/openai.service';
import { ChatStreamRequest, ChatThread } from '@chat-monorepo/shared';

const router = Router();
const aiRouterService = new AIRouterService();

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
  const { messages, model, temperature, mcpEnabled, ragContext } = req.body as ChatStreamRequest;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'Invalid request: "messages" array is required.' });
    return;
  }

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering

  try {
    await aiRouterService.handleChatStream(
      {
        messages,
        model: model || 'gemini-flash-latest',
        temperature: temperature ?? 0.7,
        mcpEnabled: mcpEnabled ?? false,
        ragContext,
      },
      res
    );
  } catch (error) {
    console.error('[Chat API Route] Stream error:', error);
    res.write(`data: ${JSON.stringify({ error: (error as Error).message, done: true })}\n\n`);
    res.end();
  }
});

/**
 * GET /api/chat/models
 * Returns available AI models and features.
 */
router.get('/models', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const models = [
    { id: 'gemini-pro-latest', name: 'Google Gemini Pro', provider: 'Google', description: 'Advanced reasoning & large context' },
    { id: 'gemini-flash-latest', name: 'Google Gemini Flash', provider: 'Google', description: 'Fast, lightweight & responsive' },
    { id: 'gpt-4o', name: 'OpenAI GPT-4o', provider: 'OpenAI', description: 'Flagship multimodal model' },
    { id: 'gpt-4o-mini', name: 'OpenAI GPT-4o Mini', provider: 'OpenAI', description: 'Affordable, fast intelligent model' },
  ];

  res.json({
    models: isOpenAiConfigured() ? models : models.filter((m) => m.provider !== 'OpenAI'),
  });
});

/**
 * GET /api/chat/users
 * Returns list of authenticated application users.
 */
router.get('/users', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const users = await UserRegistryService.getAllUsers();
  res.json({ users, count: users.length });
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

export default router;
