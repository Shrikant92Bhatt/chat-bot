export interface VectorQueryResult {
  id: string;
  score: number;
  content: string;
  metadata?: Record<string, unknown>;
}

interface StoredDocument {
  id: string;
  content: string;
  vector: number[];
  metadata?: Record<string, unknown>;
}

const EMBEDDING_DIMS = 256;

/**
 * In-memory vector store with a lightweight, dependency-free hashing
 * embedding (bag-of-words hashed into a fixed-size vector, L2-normalized).
 * This is a real, working similarity search — just not backed by an
 * external vector database (no Pinecone/Weaviate/etc. credentials are
 * configured for this project). Swap embedText()/similaritySearch() for a
 * managed vector DB client if one is provisioned later.
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

  async addDocument(id: string, content: string, metadata?: Record<string, unknown>): Promise<void> {
    const vector = await this.embedText(content);
    this.documents.push({ id, content, vector, metadata });
  }

  async similaritySearch(queryVector: number[], topK = 5): Promise<VectorQueryResult[]> {
    if (this.documents.length === 0) {
      return [];
    }

    const scored = this.documents.map((doc) => ({
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

  size(): number {
    return this.documents.length;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}
