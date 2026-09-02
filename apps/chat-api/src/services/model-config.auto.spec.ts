import { describe, it, expect } from 'vitest';
import { SELECTABLE_MODELS, AUTO_MODEL_ID } from '@chat-monorepo/shared';
import { ModelConfigService, isModelServableByGateway } from './model-config.service';

describe('Auto model routing', () => {
  it('resolves the Auto id to OpenRouter\'s auto-router slug', () => {
    expect(ModelConfigService.resolveModelSlug(AUTO_MODEL_ID)).toBe('openrouter/auto');
  });

  it('is offered in the picker', () => {
    const auto = SELECTABLE_MODELS.find((m) => m.id === AUTO_MODEL_ID);
    expect(auto).toBeDefined();
    expect(auto?.enabled).not.toBe(false);
  });

  it('carries no pricing, so the picker shows it no cost badge', () => {
    // What Auto costs depends on what it routes to for a given prompt. A
    // fixed number here would be a guess rendered to users as fact - the
    // Low/Med/High badge reads exactly this field.
    const auto = SELECTABLE_MODELS.find((m) => m.id === AUTO_MODEL_ID);
    expect(auto?.pricing).toBeUndefined();
  });

  it('is only offered when OpenRouter is the active gateway', () => {
    // `openrouter/auto` means nothing to the self-hosted OmniRoute gateway,
    // so surfacing Auto there would be a picker entry that fails every turn.
    expect(isModelServableByGateway(AUTO_MODEL_ID, true)).toBe(true);
    expect(isModelServableByGateway(AUTO_MODEL_ID, false)).toBe(false);
  });

  it('gates only Auto - every other model is servable on either gateway', () => {
    for (const model of SELECTABLE_MODELS.filter((m) => m.id !== AUTO_MODEL_ID)) {
      expect(isModelServableByGateway(model.id, false), model.id).toBe(true);
      expect(isModelServableByGateway(model.id, true), model.id).toBe(true);
    }
  });

  it('leaves every other model resolving as before', () => {
    expect(ModelConfigService.resolveModelSlug('gpt-4o')).toBe('openai/gpt-4o');
    expect(ModelConfigService.resolveModelSlug('claude-sonnet')).toBe('anthropic/claude-sonnet-5');
    // An id that is already a full slug passes straight through.
    expect(ModelConfigService.resolveModelSlug('meta-llama/llama-4-maverick')).toBe('meta-llama/llama-4-maverick');
  });
});
