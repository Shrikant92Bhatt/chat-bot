import { SearchScope, VectorDbAdapter } from './vector-db';
import { ProjectService } from '../projects/project.service';

/**
 * RAG retriever: enriches prompts with context pulled from the shared
 * in-process VectorDbAdapter instance.
 *
 * Documents are scoped two ways: by `ownerId` (the uploading user) and,
 * optionally, by `projectId`. A document ingested with a projectId is only
 * retrievable from a conversation scoped to that same project — see
 * VectorDbAdapter.inScope().
 */
export class RagRetriever {
  // Module-level singleton so documents added via ingest() persist across
  // requests within the same server process.
  private static store = new VectorDbAdapter();

  // Projects already rehydrated from Firestore in this process, so the
  // rehydration read happens at most once per project per process.
  private static hydratedProjects = new Set<string>();

  async ingest(
    id: string,
    ownerId: string,
    content: string,
    metadata?: Record<string, unknown>,
    projectId: string | null = null
  ): Promise<void> {
    await RagRetriever.store.addDocument(id, ownerId, content, metadata, projectId);
  }

  // The hashing embedding (see vector-db.ts) captures word overlap, not real
  // semantic similarity - two unrelated pieces of English text still share
  // common words (the, is, what, ...) and score barely above zero. With a
  // `> 0` threshold, a user's only uploaded document gets injected as
  // context on every message regardless of relevance. This is a coarse
  // fixed cutoff to filter out clearly-unrelated queries; it's not a
  // substitute for a real embeddings model.
  private static readonly RELEVANCE_THRESHOLD = 0.12;

  /**
   * The vector store is in-process and resets on restart, but project files
   * have their extracted text persisted in Firestore (see
   * ProjectService.addFile). This pulls that text back into the store the
   * first time a project is used in this process, so project knowledge
   * survives a redeploy even though the personal knowledge base does not.
   */
  private async ensureProjectHydrated(ownerId: string, projectId: string): Promise<void> {
    if (RagRetriever.hydratedProjects.has(projectId)) return;
    RagRetriever.hydratedProjects.add(projectId);

    if (RagRetriever.store.hasProjectDocuments(projectId)) return;

    try {
      const files = await ProjectService.listFileContents(projectId);
      for (const file of files) {
        await this.ingest(file.id, ownerId, file.text, { fileName: file.fileName, projectId }, projectId);
      }
      if (files.length > 0) {
        console.log(`[RagRetriever] Rehydrated ${files.length} file(s) for project ${projectId}.`);
      }
    } catch (error) {
      // Rehydration is an optimisation, not a correctness requirement —
      // a failure just means project files aren't retrievable this process.
      console.error('[RagRetriever] Project rehydration failed:', error);
    }
  }

  async retrieveContext(
    ownerId: string | undefined,
    query: string,
    topK = 3,
    projectId?: string | null
  ): Promise<string[]> {
    if (!ownerId) {
      return [];
    }

    if (projectId) {
      await this.ensureProjectHydrated(ownerId, projectId);
    }

    const scope: SearchScope = { ownerId, projectId: projectId ?? null };
    if (RagRetriever.store.size(scope) === 0) {
      return [];
    }

    const queryVector = await RagRetriever.store.embedText(query);
    const results = await RagRetriever.store.similaritySearch(scope, queryVector, topK);
    return results.filter((r) => r.score > RagRetriever.RELEVANCE_THRESHOLD).map((r) => r.content);
  }
}
