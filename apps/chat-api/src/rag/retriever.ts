import { VectorDbAdapter } from './vector-db';

/**
 * RAG retriever: enriches prompts with context pulled from the shared
 * in-process VectorDbAdapter instance.
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
  private static readonly RELEVANCE_THRESHOLD = 0.12;

  async retrieveContext(ownerId: string | undefined, query: string, topK = 3): Promise<string[]> {
    if (!ownerId || RagRetriever.store.size(ownerId) === 0) {
      return [];
    }
    const queryVector = await RagRetriever.store.embedText(query);
    const results = await RagRetriever.store.similaritySearch(ownerId, queryVector, topK);
    return results.filter((r) => r.score > RagRetriever.RELEVANCE_THRESHOLD).map((r) => r.content);
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
