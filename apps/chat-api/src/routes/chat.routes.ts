import { Router, Response } from 'express';
import { authenticateToken, authenticateOrAllowTrial, AuthenticatedRequest } from '../middleware/auth.middleware';
import { AIRouterService } from '../services/ai-router.service';
import { UserRegistryService } from '../services/user-registry.service';
import { ChatStreamRequest } from '@chat-monorepo/shared';

const router = Router();
const aiRouterService = new AIRouterService();

/**
 * GET /api/chat/config
 * Public endpoint returning public Client ID configuration from backend .env
 */
router.get('/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
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
        model: model || 'gemini-1.5-flash',
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
  res.json({
    models: [
      { id: 'gemini-1.5-pro', name: 'Google Gemini 1.5 Pro', provider: 'Google', description: 'Advanced reasoning & large context' },
      { id: 'gemini-1.5-flash', name: 'Google Gemini 1.5 Flash', provider: 'Google', description: 'Fast, lightweight & responsive' },
      { id: 'gpt-4o', name: 'OpenAI GPT-4o', provider: 'OpenAI', description: 'Flagship multimodal model' },
      { id: 'gpt-4o-mini', name: 'OpenAI GPT-4o Mini', provider: 'OpenAI', description: 'Affordable, fast intelligent model' },
    ],
  });
});

/**
 * GET /api/chat/users
 * Returns list of authenticated application users.
 */
router.get('/users', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  const users = UserRegistryService.getAllUsers();
  res.json({ users, count: users.length });
});

export default router;
