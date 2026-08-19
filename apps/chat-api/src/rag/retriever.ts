import { VectorDbAdapter } from './vector-db';
import { hybridRerank, llmRerank } from './reranker';

export interface RetrieveContextOptions {
  // Opt-in only - see reranker.ts's llmRerank() docs for why this is not
  // part of the default path (adds a network round trip, well over the
  // project's <300ms RAG retrieval budget).
  useLlmRerank?: boolean;
}

/**
 * RAG retriever: enriches prompts with context pulled from the shared
 * in-process VectorDbAdapter instance.
 *
 * retrieveContext() implements the project's documented RAG flow (see
 * .agents/PROJECT_CONTEXT.md): Vector Search -> Fusion -> Reranker -> Top K
 * Chunks. "Vector Search" over-fetches a candidate pool by cosine
 * similarity, "Fusion"+"Reranker" are handled by reranker.ts's
 * hybridRerank() (BM25 lexical ranking fused with the vector ranking via
 * Reciprocal Rank Fusion), and the result is truncated to topK.
 */
export class RagRetriever {
  // Module-level singleton so documents added via ingest() persist across
  // requests within the same server process.
  private static store = new VectorDbAdapter();

  async ingest(id: string, ownerId: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    await RagRetriever.store.addDocument(id, ownerId, content, metadata);
  }

  // The hashing embedding (see vector-db.ts) captures word overlap, not real
  // semantic similarity - two unrelated pieces of English text still share
  // common words (the, is, what, ...) and score barely above zero. With a
  // `> 0` threshold, a user's only uploaded document gets injected as
  // context on every message regardless of relevance. This is a coarse
  // fixed cutoff to filter out clearly-unrelated queries; it's not a
  // substitute for a real embeddings model.
  //
  // Applied to the raw cosine score, before reranking - reranking only
  // reorders candidates that already cleared this recall-stage relevance
  // bar, it doesn't rescue candidates the vector search itself found
  // irrelevant.
  private static readonly RELEVANCE_THRESHOLD = 0.12;

  // How many extra candidates to pull from the vector search beyond topK,
  // so the reranker has real material to work with instead of just
  // reordering an already-truncated top-3. Kept small since this store is
  // per-user, in-memory, and typically holds only a handful of chunks -
  // cost stays negligible either way (see reranker.ts's latency notes).
  private static readonly CANDIDATE_POOL_MULTIPLIER = 4;
  private static readonly MIN_CANDIDATE_POOL = 10;

  async retrieveContext(
    ownerId: string | undefined,
    query: string,
    topK = 3,
    options: RetrieveContextOptions = {}
  ): Promise<string[]> {
    if (!ownerId || RagRetriever.store.size(ownerId) === 0) {
      return [];
    }
    const queryVector = await RagRetriever.store.embedText(query);
    const candidatePoolSize = Math.max(topK * RagRetriever.CANDIDATE_POOL_MULTIPLIER, RagRetriever.MIN_CANDIDATE_POOL);
    const candidates = await RagRetriever.store.similaritySearch(ownerId, queryVector, candidatePoolSize);
    const relevant = candidates.filter((r) => r.score > RagRetriever.RELEVANCE_THRESHOLD);

    let ranked = hybridRerank(query, relevant, options.useLlmRerank ? Math.max(topK * 2, 5) : topK);
    if (options.useLlmRerank) {
      ranked = await llmRerank(query, ranked, topK);
    }

    return ranked.map((r) => r.content);
  }

  async enrichPrompt(
    messages: Array<{ role: string; content: string }>,
    contextDocuments: string[]
  ): Promise<Array<{ role: 'user' | 'assistant' | 'system'; content: string }>> {
    const mappedMessages = messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));

    if (!contextDocuments || contextDocuments.length === 0) {
      return mappedMessages;
    }

    const contextStr = contextDocuments.join('\n\n');
    const systemPrompt = {
      role: 'system' as const,
      content: `Use the following context to answer the user's questions:\n\n${contextStr}`,
    };

    return [systemPrompt, ...mappedMessages];
  }
}
