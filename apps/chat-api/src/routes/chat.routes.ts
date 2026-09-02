import { Router, Response, Request, NextFunction } from 'express';
import multer from 'multer';
import { authenticateToken, authenticateOrAllowTrial, AuthenticatedRequest } from '../middleware/auth.middleware';
import { AIRouterService } from '../services/ai-router.service';
import { UserRegistryService } from '../services/user-registry.service';
import { ThreadService } from '../services/thread.service';
import { isOpenAiConfigured } from '../services/openai.service';
import { ChatAttachment, ChatStreamRequest, ChatThread, normalizeAttachmentKind, AUTO_MODEL_ID } from '@chat-monorepo/shared';
import { streamGraphResponse } from '../orchestration/graph';
import { StorageMetricsService } from '../storage/metrics';
import { generateImage } from '../llm/image-gen';
import { generateVideo, listVideoModels } from '../llm/video-gen';
import { VideoGenerationError, VideoErrorCode } from '../llm/video-modes';
import { isOmniRouteConfigured, isUsingOpenRouter } from '../llm/client';
import { extractDocumentText } from '../rag/document-extractor';
import { RagRetriever } from '../rag/retriever';
import { GcsUploader } from '../storage/uploader';
import { UsageService } from '../services/usage.service';
import { MessageFeedbackService } from '../services/message-feedback.service';
import { MemoryService } from '../memory/memory.service';
import { listPromptTemplates } from '../prompt/prompt-manager';
import { ModelConfigService, isModelServableByGateway } from '../services/model-config.service';
import { SystemLimitsService } from '../services/system-limits.service';
import { AnonUsageService } from '../services/anon-usage.service';

const router = Router();
const aiRouterService = new AIRouterService();

/**
 * multer's `limits` are fixed at instantiation and can't be changed at
 * request time, so these are absolute safety ceilings only - generous
 * enough to never bind in practice, since SystemLimitsService.getLimits()
 * (admin-editable, see services/system-limits.service.ts) is what's actually
 * enforced in each handler below, request by request. This is what makes
 * the document-upload and attachment size/count caps admin-tunable without
 * a redeploy: the admin-configured value is always <= these ceilings
 * (SystemLimitsService clamps to them), so it's the one that actually bites.
 */
const HARD_MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const HARD_MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const HARD_MAX_ATTACHMENTS_PER_MESSAGE = 10;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: HARD_MAX_DOCUMENT_BYTES } });

const mediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: HARD_MAX_ATTACHMENT_BYTES, files: HARD_MAX_ATTACHMENTS_PER_MESSAGE },
});

/**
 * multer's own limit errors (file too large, too many files) throw BEFORE
 * the route handler runs, so a plain try/catch around the handler body never
 * sees them - they'd otherwise fall through to Express's default handler as
 * an unhelpful 500. This translates them into the same friendly 400 JSON
 * shape every other validation failure in this file uses. Hitting this ceiling
 * at all means a request blew well past the admin-configured limit (which is
 * checked separately, inside the handler, against the current live value).
 */
function handleMediaUpload(req: Request, res: Response, next: NextFunction): void {
  mediaUpload.array('files', HARD_MAX_ATTACHMENTS_PER_MESSAGE)(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    const code = (error as { code?: string }).code;
    if (code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: `Each attachment must be ${HARD_MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB or smaller.` });
      return;
    }
    if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({ error: `You can attach up to ${HARD_MAX_ATTACHMENTS_PER_MESSAGE} files at once.` });
      return;
    }
    console.error('[Chat API Route] Attachment upload middleware error:', error);
    res.status(400).json({ error: 'Failed to process the uploaded file(s).' });
  });
}

/** Strips path separators and anything but a conservative safe set before a
 *  user-supplied filename becomes part of a GCS object path. */
function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() || 'file';
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
}

/**
 * GET /api/chat/config
 * Public endpoint returning public Client ID configuration from backend .env,
 * plus the currently effective (admin-editable, see system-limits.service.ts)
 * upload limits - the frontend uses these for its own client-side
 * pre-validation instead of hardcoding a second copy that could drift from
 * whatever an admin has actually configured server-side.
 */
router.get('/config', async (req, res) => {
  const limits = await SystemLimitsService.getLimits();
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    openAiConfigured: isOpenAiConfigured(),
    documentUploadMaxBytes: limits.documentUploadMaxBytes,
    attachmentMaxBytes: limits.attachmentMaxBytes,
    attachmentMaxCount: limits.attachmentMaxCount,
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

  // Hard ceiling across every model. Must run before SSE headers so the
  // client can parse a JSON 429 (see chat.service.ts).
  if (req.user?.uid) {
    const daily = await AnonUsageService.checkAuthDaily(req.user.uid);
    if (!daily.allowed) {
      res.status(429).json({
        error: 'RateLimitExceeded',
        message: `You've reached today's message limit (${daily.limit}). Try a different time window, or ask an admin to raise the signed-in daily cap.`,
        resetAt: daily.resetAt,
        remaining: daily.remaining,
        limit: daily.limit,
      });
      return;
    }
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
      await streamGraphResponse(streamRequest, res, req.user?.uid, { name: req.user?.name, email: req.user?.email });
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
    const usingOpenRouter = isUsingOpenRouter();
    const enabledModels = config.models.filter(
      (m) => m.enabled !== false && isModelServableByGateway(m.id, usingOpenRouter)
    );
    // ModelConfigService caches and reuses these exact model objects across
    // requests/users - copy before attaching per-user `usage` below so one
    // user's standing can never leak onto another's response via the shared
    // cache instance.
    const models = (enabledModels.length > 0 ? enabledModels : config.models).map((m) => ({ ...m }));

    // Only a signed-in caller has a stable per-user key to check usage
    // against - anonymous requests get the models list with no usage
    // enrichment (uncapped either way, since only auth.middleware.ts's
    // trial-message gate applies to them).
    const uid = req.user?.uid;
    if (uid) {
      const cappedModels = models.filter((m) => m.dailyLimitPerUser);
      if (cappedModels.length > 0) {
        const limits = await SystemLimitsService.getLimits();
        const windowMs = limits.rateLimitWindowHours * 60 * 60 * 1000;
        await Promise.all(
          cappedModels.map(async (m) => {
            const { count, resetAt } = await AnonUsageService.peek(AnonUsageService.modelUsageKey(uid, m.id), windowMs);
            m.usage = { disabled: count >= (m.dailyLimitPerUser as number), resetAt };
          })
        );
      }
    }

    res.json({ defaultModel: config.defaultModel, models });
  } catch (error) {
    console.error('[Chat API Route] Failed to load model config:', error);
    res.status(500).json({ error: 'Failed to load models.' });
  }
});

/**
 * GET /api/chat/video-models
 * Returns the live OpenRouter video-model catalog (see llm/video-gen.ts) for
 * the Video composer mode's model picker. No per-user usage/limit
 * enrichment, unlike /models above - video generation has no daily-cap
 * config today.
 */
router.get('/video-models', authenticateOrAllowTrial, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const models = await listVideoModels();
    res.json({ models });
  } catch (error) {
    console.error('[Chat API Route] Failed to load video model catalog:', error);
    res.status(500).json({ error: 'Failed to load video models.' });
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
    // Forward the real reason (e.g. Firestore's 1MiB document size limit on
    // a long thread, a permission error, a transient outage) instead of a
    // flat string - the client previously didn't even check this response
    // for success, so a failed save was invisible until the next reload
    // silently came back missing whatever didn't save. See chat.service.ts
    // persistUserThreadHistory().
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save chat threads.' });
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

// HTTP status per VideoErrorCode - client-caused/detected-before-any-
// provider-call issues are 400 (never worth retrying as-is); provider-side
// issues are 502/503; our own storage layer or anything unclassified is 500.
const VIDEO_ERROR_STATUS: Record<VideoErrorCode, number> = {
  MISSING_PROMPT: 400,
  UNSUPPORTED_REFERENCE_VIDEO: 400,
  PROVIDER_NOT_CONFIGURED: 503,
  PROVIDER_ERROR: 502,
  TIMEOUT: 504,
  RESULT_MISSING: 502,
  STORAGE_ERROR: 500,
  UNKNOWN_ERROR: 500,
};

/**
 * POST /api/chat/generate-video
 * Body: { prompt, model?, referenceImageUrls?, referenceVideoUrls? }.
 * referenceImageUrls/referenceVideoUrls are hosted URLs already returned by
 * POST /attachments (the Video composer mode stages attachments through
 * that same endpoint before calling this one). Images guide generation via
 * OpenRouter's input_references; videos are NOT sent to the provider (no
 * OpenRouter video model accepts a video as input) - they're accepted here
 * only so generateVideo()'s capability gate can detect that intent and
 * reject it with a clear, actionable reason instead of silently dropping it
 * and submitting (and paying for) a request that can't do what was asked.
 * See llm/video-modes.ts and llm/video-gen.ts.
 *
 * On failure, returns { error, errorCode, retryable } (see VideoErrorCode)
 * rather than a flat string - error is always the real underlying reason
 * (generateVideo() throws VideoGenerationError at every failure point, never
 * a plain Error), which is what makes a failure diagnosable in the chat UI
 * itself instead of only in server logs.
 */
router.post('/generate-video', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { prompt, model, referenceImageUrls, referenceVideoUrls } = req.body;
  try {
    const { videoUrl } = await generateVideo(prompt || '', {
      model: typeof model === 'string' ? model : undefined,
      referenceImageUrls: Array.isArray(referenceImageUrls) ? referenceImageUrls.filter((u) => typeof u === 'string') : undefined,
      referenceVideoUrls: Array.isArray(referenceVideoUrls) ? referenceVideoUrls.filter((u) => typeof u === 'string') : undefined,
    });
    res.json({ success: true, videoUrl, prompt });
  } catch (error) {
    console.error('[Chat API Route] Video generation error:', error);
    if (error instanceof VideoGenerationError) {
      res.status(VIDEO_ERROR_STATUS[error.code]).json({ error: error.message, errorCode: error.code, retryable: error.retryable });
      return;
    }
    // Anything reaching here is a bug (generateVideo is expected to always
    // throw VideoGenerationError) rather than an expected failure mode -
    // still forward the real message (never contains the API key, which is
    // only ever sent as a header, not echoed back or included in Error
    // messages) so it's diagnosable without server log access either way.
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate video.',
      errorCode: 'UNKNOWN_ERROR',
      retryable: false,
    });
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

    const limits = await SystemLimitsService.getLimits();
    if (file.size > limits.documentUploadMaxBytes) {
      res.status(400).json({
        error: `File is too large - documents must be ${Math.round(limits.documentUploadMaxBytes / (1024 * 1024))}MB or smaller.`,
      });
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
 * POST /api/chat/attachments
 * Uploads up to 4 photos/videos (25MB each) to attach to the NEXT chat
 * message, distinct from /documents above: these ride along with a single
 * turn rather than joining the RAG knowledge base. Returns each as an
 * already-hosted ChatAttachment; the client stages them and sends the
 * resulting URLs (not file bytes) with the next /stream request. Images are
 * later handed to the model as vision input (see orchestration/graph.ts
 * toMessageContent()); videos are stored and shown in the chat only.
 */
router.post('/attachments', authenticateToken, handleMediaUpload, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    if (files.length === 0) {
      res.status(400).json({ error: 'No files were uploaded (expected multipart field "files").' });
      return;
    }

    const limits = await SystemLimitsService.getLimits();
    if (files.length > limits.attachmentMaxCount) {
      res.status(400).json({ error: `You can attach up to ${limits.attachmentMaxCount} files at once.` });
      return;
    }

    const uploader = new GcsUploader();
    const attachments: ChatAttachment[] = [];

    for (const file of files) {
      const kind = normalizeAttachmentKind(file.mimetype);
      if (!kind) {
        res.status(400).json({
          error: `Unsupported file type "${file.mimetype}". Supported: photos (jpg, png, webp, gif, heic) and video (mp4, mov, webm).`,
        });
        return;
      }
      if (file.size > limits.attachmentMaxBytes) {
        res.status(400).json({
          error: `"${file.originalname}" is too large - attachments must be ${Math.round(limits.attachmentMaxBytes / (1024 * 1024))}MB or smaller.`,
        });
        return;
      }

      const objectName = `attachments/${req.user!.uid}/${Date.now()}-${attachments.length}-${sanitizeFileName(file.originalname)}`;
      const url = await uploader.uploadFile(file.buffer, objectName, file.mimetype);

      attachments.push({
        id: `att-${Date.now()}-${attachments.length}`,
        kind,
        url,
        contentType: file.mimetype,
        fileName: file.originalname,
        sizeBytes: file.size,
      });
    }

    res.json({ attachments });
  } catch (error) {
    console.error('[Chat API Route] Attachment upload error:', error);
    res.status(400).json({ error: (error as Error).message || 'Failed to upload attachment(s).' });
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
 * POST /api/chat/feedback
 * Thumbs up/down on one assistant message. Keyed on
 * { userId (from the verified session token, never client-supplied),
 * threadId, messageId } - see services/message-feedback.service.ts for why
 * this isn't correlated to usage.service.ts's requestId instead. Ownership
 * of threadId is verified the same way every other resource in this
 * codebase is (ThreadService.getThread) before any write - a threadId
 * belonging to another user 404s rather than 403s, so ids can't be probed
 * (AGENTS.md §2b).
 *
 * `rating: null` clears an existing rating - re-POSTing the same rating the
 * message already has is how the client implements "click the selected
 * thumb again to un-rate" (toggle off), by sending null instead of
 * repeating the rating.
 */
router.post('/feedback', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  const { threadId, messageId, rating } = req.body ?? {};

  if (typeof threadId !== 'string' || !threadId || typeof messageId !== 'string' || !messageId) {
    res.status(400).json({ error: 'Invalid request: "threadId" and "messageId" are required.' });
    return;
  }
  if (rating !== 'up' && rating !== 'down' && rating !== null) {
    res.status(400).json({ error: 'Invalid request: "rating" must be "up", "down", or null.' });
    return;
  }

  try {
    const thread = await ThreadService.getThread(req.user!.uid, threadId);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found.' });
      return;
    }

    await MessageFeedbackService.setRating(req.user!.uid, threadId, messageId, rating);
    res.json({ success: true, rating });
  } catch (error) {
    console.error('[Chat API Route] Failed to save message feedback:', error);
    res.status(500).json({ error: 'Failed to save feedback.' });
  }
});

/**
 * GET /api/chat/threads/:threadId/feedback
 * Every message the caller has rated in this thread, keyed by messageId -
 * lets the client restore thumbs-up/down state when a conversation is
 * reopened (see ChatService.loadFeedbackForThread) instead of resetting to
 * neutral on every load. Same ownership check as POST /feedback above, but
 * a thread that doesn't exist under the caller (never persisted yet, or
 * someone else's id) resolves to an empty map rather than a 404: it's a
 * read, "nothing rated" is the correct answer either way, and the response
 * is identical for both causes so neither leaks which one it was.
 */
router.get('/threads/:threadId/feedback', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const thread = await ThreadService.getThread(req.user!.uid, req.params.threadId);
    if (!thread) {
      res.json({ feedback: {} });
      return;
    }
    const feedback = await MessageFeedbackService.getFeedbackForThread(req.user!.uid, req.params.threadId);
    res.json({ feedback });
  } catch (error) {
    console.error('[Chat API Route] Failed to load message feedback:', error);
    res.status(500).json({ error: 'Failed to load feedback.' });
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
 * GET/PUT /api/chat/profile
 * The explicit "About you" text the user writes themselves (ChatGPT's
 * Custom Instructions) - distinct from the auto-extracted /memories list
 * above. Always injected into the system prompt; the user is the only
 * writer.
 */
router.get('/profile', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const aboutMe = await MemoryService.getProfile(req.user!.uid);
    res.json({ aboutMe });
  } catch (error) {
    console.error('[Chat API Route] Failed to load profile:', error);
    res.status(500).json({ error: 'Failed to load profile.' });
  }
});

router.put('/profile', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const aboutMe = typeof req.body?.aboutMe === 'string' ? req.body.aboutMe : '';
    await MemoryService.setProfile(req.user!.uid, aboutMe);
    res.json({ success: true, aboutMe: aboutMe.trim().slice(0, 2000) });
  } catch (error) {
    console.error('[Chat API Route] Failed to save profile:', error);
    res.status(500).json({ error: 'Failed to save profile.' });
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
