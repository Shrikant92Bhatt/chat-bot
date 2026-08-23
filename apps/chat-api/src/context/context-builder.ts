import { MessageRole } from '@chat-monorepo/shared';
import { AssembledContext } from '../prompt/prompt-manager';
import { RagRetriever } from '../rag/retriever';
import { MemoryService } from '../memory/memory.service';
import { ProjectService } from '../projects/project.service';
import { SummarizationService, SimpleMessage } from '../summarization/summarizer';
import { HeadroomCompressor } from './headroom-compressor';

export interface ContextRequest {
  uid?: string;
  /** From the verified Google session (auth.middleware.ts) - see buildContext's account-identity block below. */
  userName?: string;
  userEmail?: string;
  threadId?: string;
  projectId?: string | null;
  messages: SimpleMessage[];
}

export interface BuiltContext {
  context: AssembledContext;
  /** The history to actually send this turn (summarized history is trimmed). */
  messages: SimpleMessage[];
}

/**
 * The single context-assembly step for a chat turn. Gathers, in parallel,
 * everything the Prompt Manager needs:
 *
 *   1. Project      — the project's custom instructions, when the
 *                     conversation is scoped to one.
 *   2. Memory       — durable user-level facts relevant to this message.
 *   3. RAG          — knowledge-base excerpts, scoped to the user and (when
 *                     present) the project.
 *   4. Summarization— a rolling summary replacing older turns once the
 *                     thread crosses the token/message budget.
 *
 * These four used to be four separate would-be rewrites of the same code
 * path; keeping them here means the ordering, the token budget, and the
 * failure behaviour are decided once. Every sub-step fails soft: a broken
 * Firestore or a missing LLM key degrades the answer, it does not break the
 * turn.
 */
export async function buildContext(request: ContextRequest): Promise<BuiltContext> {
  const { uid, userName, userEmail, threadId, projectId, messages } = request;
  const history = messages || [];
  const lastUserMessage = [...history].reverse().find((m) => m.role === 'user');
  const query = lastUserMessage?.content || '';

  const ragRetriever = new RagRetriever();

  const [projectResult, memoriesResult, ragResult, conversationResult] = await Promise.allSettled([
    uid && projectId ? ProjectService.getProject(uid, projectId) : Promise.resolve(null),
    MemoryService.getRelevantMemories(uid, query),
    query ? ragRetriever.retrieveContext(uid, query, 3, projectId) : Promise.resolve([] as string[]),
    SummarizationService.buildConversationContext({ uid, threadId, messages: history }),
  ]);

  const project = projectResult.status === 'fulfilled' ? projectResult.value : null;
  if (projectResult.status === 'rejected') {
    console.error('[ContextBuilder] Failed to load project:', projectResult.reason);
  }

  const memories = memoriesResult.status === 'fulfilled' ? memoriesResult.value : [];
  const rawRagContext = ragResult.status === 'fulfilled' ? ragResult.value : [];
  if (ragResult.status === 'rejected') {
    console.error('[ContextBuilder] RAG retrieval failed:', ragResult.reason);
  }

  // Compress RAG chunks via Headroom CCR pattern to minimize token usage
  const { chunks: ragContext } = HeadroomCompressor.compressRagChunks(rawRagContext);

  const conversation =
    conversationResult.status === 'fulfilled'
      ? conversationResult.value
      : { summary: null, recentMessages: history, summarized: false };
  if (conversationResult.status === 'rejected') {
    console.error('[ContextBuilder] Summarization failed, sending full history:', conversationResult.reason);
  }

  return {
    context: {
      accountName: userName ?? null,
      accountEmail: userEmail ?? null,
      projectName: project?.name ?? null,
      projectInstructions: project?.instructions ?? null,
      memories,
      ragContext,
      conversationSummary: conversation.summary,
    },
    messages: conversation.recentMessages,
  };
}

/**
 * Fire-and-forget write-back after a turn finishes: decides whether the
 * user's latest message contained anything worth remembering long-term.
 * Runs after the response so it never adds latency to the stream.
 */
export function recordTurnMemories(params: {
  uid?: string;
  threadId?: string;
  messages: Array<{ role: MessageRole | string; content: string }>;
}): void {
  const { uid, threadId, messages } = params;
  if (!uid) return;

  const lastUserMessage = [...(messages || [])].reverse().find((m) => m.role === 'user');
  if (!lastUserMessage?.content) return;

  MemoryService.rememberFromMessage(uid, lastUserMessage.content, threadId ?? null).catch((error) =>
    console.error('[ContextBuilder] Memory write-back failed:', error)
  );
}
