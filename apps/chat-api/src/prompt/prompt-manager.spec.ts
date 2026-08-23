import { describe, it, expect } from 'vitest';
import { renderPrompt, getTemplate } from './prompt-manager';

describe('PromptManager Unit Tests', () => {
  it('should retrieve versioned templates correctly', () => {
    const template = getTemplate('chat:v1');
    expect(template).toBeDefined();
    expect(template?.id).toBe('chat');
    expect(template?.version).toBe('v1');
  });

  it('should render templates with interpolated variables', () => {
    const rendered = renderPrompt('memory_extraction:v1', { message: 'I love TypeScript' });
    expect(rendered).toContain('I love TypeScript');
  });

  it('should throw when a non-existent template key is requested', () => {
    expect(() => getTemplate('non_existent_key:v999')).toThrow();
  });
});
