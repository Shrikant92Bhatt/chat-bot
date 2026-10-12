import { query } from '../db/postgres';

export interface VectorQueryResult {
  id: string;
  score: number;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SearchScope {
  ownerId: string;
  /** When set, project documents for this project become visible alongside the personal KB. */
  projectId?: string | null;
}

const EMBEDDING_DIMS = 256;

interface RagDocumentRow {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  score: number;
}

/** pgvector has no native JS binding - `vector` columns are written/read as
 *  the literal text form `[0.1,0.2,...]`, cast with `::vector` in SQL. */
function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

/**
 * Persisted vector store, backed by Postgres + pgvector.
 *
 * Replaces a per-process, in-memory store that had a documented limitation:
 * lost on every restart/redeploy, and inconsistent across multiple
 * concurrent instances. That was already a real gap on Cloud Run; on
 * Vercel's serverless functions - which recycle instances far more
 * aggressively, with no guarantee two requests even hit the same warm
 * instance - it meant uploaded knowledge bases could vanish mid-session.
 * Persisting to Postgres fixes that outright, independent of which compute
 * platform runs the API.
 *
 * The embedding itself is UNCHANGED: still the lightweight, dependency-free
 * hashing embedding below (bag-of-words hashed into a fixed-size vector,
 * L2-normalized) - captures word overlap, not real semantic similarity.
 * Swapping in a real embeddings model is a separate, bigger change; this
 * pass is about making whatever embedding exists actually survive a
 * restart, not about embedding quality.
 *
 * Documents are scoped by ownerId (the uploading user's uid) so one user's
 * uploaded knowledge never leaks into another user's chat context.
 */
export class VectorDbAdapter {
  async embedText(text: string): Promise<number[]> {
    const vector = new Array(EMBEDDING_DIMS).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || [];

    for (const token of tokens) {
      let hash = 0;
      for (let i = 0; i < token.length; i++) {
        hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
      }
      vector[hash % EMBEDDING_DIMS] += 1;
    }

    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }

  async addDocument(
    id: string,
    ownerId: string,
    content: string,
    metadata?: Record<string, unknown>,
    projectId: string | null = null
  ): Promise<void> {
    const vector = await this.embedText(content);
    // Re-ingesting the same id (e.g. after a project rehydration) replaces
    // rather than duplicates the document.
    await query(
      `
      INSERT INTO rag_documents (id, owner_id, project_id, content, embedding, metadata, created_at)
      VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb, $7)
      ON CONFLICT (id) DO UPDATE SET
        owner_id = $2, project_id = $3, content = $4, embedding = $5::vector, metadata = $6::jsonb, created_at = $7
      `,
      [id, ownerId, projectId, content, toVectorLiteral(vector), metadata ? JSON.stringify(metadata) : null, Date.now()]
    );
  }

  /**
   * Visibility rule: a document is searchable when the requester owns it AND
   * it is either personal (project_id IS NULL) or belongs to the project the
   * conversation is scoped to. A project's files therefore never surface in
   * a conversation outside that project, nor in another project. Expressed
   * directly in SQL below - `project_id = $3` is never true when $3 is NULL,
   * so an unscoped search (no projectId) naturally only matches personal docs.
   */
  async similaritySearch(scope: SearchScope, queryVector: number[], topK = 5): Promise<VectorQueryResult[]> {
    const rows = await query<RagDocumentRow>(
      `
      SELECT id, content, metadata, 1 - (embedding <=> $1::vector) AS score
      FROM rag_documents
      WHERE owner_id = $2 AND (project_id IS NULL OR project_id = $3)
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $4
      `,
      [toVectorLiteral(queryVector), scope.ownerId, scope.projectId ?? null, topK]
    );

    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      metadata: row.metadata ?? undefined,
      score: row.score,
    }));
  }

  isConnected(): boolean {
    return true;
  }

  async size(scope?: SearchScope): Promise<number> {
    if (!scope) {
      const rows = await query<{ count: number }>('SELECT COUNT(*)::int AS count FROM rag_documents');
      return rows[0]?.count ?? 0;
    }
    const rows = await query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM rag_documents WHERE owner_id = $1 AND (project_id IS NULL OR project_id = $2)',
      [scope.ownerId, scope.projectId ?? null]
    );
    return rows[0]?.count ?? 0;
  }

  async hasProjectDocuments(projectId: string): Promise<boolean> {
    const rows = await query<{ exists: boolean }>('SELECT EXISTS(SELECT 1 FROM rag_documents WHERE project_id = $1) AS exists', [
      projectId,
    ]);
    return rows[0]?.exists ?? false;
  }
}
