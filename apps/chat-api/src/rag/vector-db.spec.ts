import { describe, it, expect } from 'vitest';
import { VectorDbAdapter } from './vector-db';

describe('VectorDbAdapter Unit Tests', () => {
  it('should generate hashing embeddings with expected dimensions', async () => {
    const adapter = new VectorDbAdapter();
    const vector = await adapter.embedText('Testing vector embedding generation');

    expect(vector.length).toBe(256);
    expect(vector.some((v) => v !== 0)).toBe(true);
  });

  it('should store documents and retrieve relevant vector candidates scoped by owner', async () => {
    const adapter = new VectorDbAdapter();
    const scope = { ownerId: 'user-123', projectId: null };

    await adapter.addDocument('doc-1', 'user-123', 'TypeScript monorepo architecture and Angular signals');
    await adapter.addDocument('doc-2', 'user-999', 'Unrelated Python machine learning document');

    expect(adapter.size(scope)).toBe(1);

    const queryVector = await adapter.embedText('Angular signals architecture');
    const results = await adapter.similaritySearch(scope, queryVector, 5);

    expect(results.length).toBe(1);
    expect(results[0].id).toBe('doc-1');
    expect(results[0].score).toBeGreaterThan(0);
  });
});
