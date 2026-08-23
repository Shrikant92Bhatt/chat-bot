import { describe, it, expect } from 'vitest';
import { buildContext } from './context-builder';

describe('ContextBuilder Unit Tests', () => {
  it('should assemble context with fallback defaults when external stores fail soft', async () => {
    const result = await buildContext({
      uid: 'user-test',
      threadId: 'thread-1',
      projectId: null,
      messages: [{ role: 'user', content: 'What is the monorepo design?' }],
    });

    expect(result).toBeDefined();
    expect(result.context).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.context.projectName).toBeNull();
  });
});
