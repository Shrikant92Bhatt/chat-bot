export interface VectorQueryResult {
  id: string;
  score: number;
  content: string;
  metadata?: Record<string, unknown>;
}

interface StoredDocument {
  id: string;
  ownerId: string;
  /**
   * Project this document belongs to, or null for the user's personal
   * knowledge base. Project documents are only ever retrievable from a
   * conversation scoped to that same project (see similaritySearch).
   */
  projectId: string | null;
  content: string;
  vector: number[];
  metadata?: Record<string, unknown>;
}

export interface SearchScope {
  ownerId: string;
  /** When set, project documents for this project become visible alongside the personal KB. */
  projectId?: string | null;
}

const EMBEDDING_DIMS = 256;

/**
 * In-memory vector store with a lightweight, dependency-free hashing
 * embedding (bag-of-words hashed into a fixed-size vector, L2-normalized).
 * This is a real, working similarity search — just not backed by an
 * external vector database (no Pinecone/Weaviate/etc. credentials are
 * configured for this project). Swap embedText()/similaritySearch() for a
 * managed vector DB client if one is provisioned later.
 *
 * Documents are scoped by ownerId (the uploading user's uid) so one user's
 * uploaded knowledge never leaks into another user's chat context.
 *
 * KNOWN LIMITATION: this is per-process, in-memory state. On Cloud Run
 * with more than one instance/replica, a document uploaded to one instance
 * won't be visible to a chat request served by a different instance, and
 * everything is lost on restart/redeploy. Fine for a single-instance dev
 * setup; move to a persisted store (Firestore + a real embeddings model)
 * before relying on this for production knowledge bases.
 */
export class VectorDbAdapter {
  private documents: StoredDocument[] = [];

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
    this.documents = this.documents.filter((d) => d.id !== id);
    this.documents.push({ id, ownerId, projectId, content, vector, metadata });
  }

  /**
   * Visibility rule: a document is searchable when the requester owns it AND
   * it is either personal (projectId === null) or belongs to the project the
   * conversation is scoped to. A project's files therefore never surface in
   * a conversation outside that project, nor in another project.
   */
  private inScope(doc: StoredDocument, scope: SearchScope): boolean {
    if (doc.ownerId !== scope.ownerId) return false;
    if (doc.projectId === null) return true;
    return !!scope.projectId && doc.projectId === scope.projectId;
  }

  async similaritySearch(scope: SearchScope, queryVector: number[], topK = 5): Promise<VectorQueryResult[]> {
    const visible = this.documents.filter((doc) => this.inScope(doc, scope));
    if (visible.length === 0) {
      return [];
    }

    const scored = visible.map((doc) => ({
      id: doc.id,
      content: doc.content,
      metadata: doc.metadata,
      score: cosineSimilarity(queryVector, doc.vector),
    }));

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  isConnected(): boolean {
    return true;
  }

  size(scope?: SearchScope): number {
    if (!scope) return this.documents.length;
    return this.documents.filter((d) => this.inScope(d, scope)).length;
  }

  hasProjectDocuments(projectId: string): boolean {
    return this.documents.some((d) => d.projectId === projectId);
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
