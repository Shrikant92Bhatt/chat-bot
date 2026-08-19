import { SearchScope, VectorDbAdapter } from './vector-db';
import { ProjectService } from '../projects/project.service';
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
 *
 * Documents are scoped two ways: by `ownerId` (the uploading user) and,
 * optionally, by `projectId`. A document ingested with a projectId is only
 * retrievable from a conversation scoped to that same project — see
 * VectorDbAdapter's SearchScope.
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
    projectId?: string | null,
    options: RetrieveContextOptions = {}
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
    const candidatePoolSize = Math.max(topK * RagRetriever.CANDIDATE_POOL_MULTIPLIER, RagRetriever.MIN_CANDIDATE_POOL);
    const candidates = await RagRetriever.store.similaritySearch(scope, queryVector, candidatePoolSize);
    const relevant = candidates.filter((r) => r.score > RagRetriever.RELEVANCE_THRESHOLD);

    let ranked = hybridRerank(query, relevant, options.useLlmRerank ? Math.max(topK * 2, 5) : topK);
    if (options.useLlmRerank) {
      ranked = await llmRerank(query, ranked, topK);
    }

    return ranked.map((r) => r.content);
  }
}
