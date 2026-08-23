import { describe, it, expect } from 'vitest';
import { hybridRerank } from './reranker';
import { VectorSearchResult } from './vector-db';

describe('RAG Reranker Unit Tests', () => {
  it('should rank documents using Reciprocal Rank Fusion of dense vector and BM25 scores', () => {
    const candidates: VectorSearchResult[] = [
      { id: '1', ownerId: 'u1', content: 'General information about software', score: 0.85, metadata: {}, projectId: null },
      { id: '2', ownerId: 'u1', content: 'Exact match for quantum routing agent algorithms', score: 0.70, metadata: {}, projectId: null },
    ];

    const ranked = hybridRerank('quantum routing agent', candidates, 2);

    expect(ranked.length).toBe(2);
    expect(ranked[0].id).toBe('1');
  });
});
