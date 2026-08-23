import { describe, it, expect } from 'vitest';
import { extractMemoryCandidates, looksMemorable } from './extractor';

describe('MemoryExtractor Unit Tests', () => {
  it('should identify memorable first-person statements via looksMemorable gate', () => {
    const candidate1 = looksMemorable('My name is Alice and I am a software engineer');
    expect(candidate1.memorable).toBe(true);
    expect(candidate1.kind).toBe('identity');

    const candidate2 = looksMemorable('Remember that I prefer concise code answers');
    expect(candidate2.memorable).toBe(true);
    expect(candidate2.kind).toBe('instruction');
  });

  it('should reject generic questions or short greetings from memory extraction', () => {
    const question = looksMemorable('What is the weather today?');
    expect(question.memorable).toBe(false);

    const greeting = looksMemorable('Hi');
    expect(greeting.memorable).toBe(false);
  });

  it('should fallback gracefully during extraction when LLM API key is missing', async () => {
    const candidates = await extractMemoryCandidates('My name is Bob and I live in Seattle');
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].content).toContain('My name is Bob');
  });
});
