import { VectorDbAdapter } from './vector-db';

/**
 * RAG retriever: enriches prompts with context pulled from the shared
 * in-process VectorDbAdapter instance.
 */
export class RagRetriever {
  // Module-level singleton so documents added via ingest() persist across
  // requests within the same server process.
  private static store = new VectorDbAdapter();

  async ingest(id: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    await RagRetriever.store.addDocument(id, content, metadata);
  }

  async retrieveContext(query: string, topK = 3): Promise<string[]> {
    if (RagRetriever.store.size() === 0) {
      return [];
    }
    const queryVector = await RagRetriever.store.embedText(query);
    const results = await RagRetriever.store.similaritySearch(queryVector, topK);
    return results.filter((r) => r.score > 0).map((r) => r.content);
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
