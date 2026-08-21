import { firestore } from '../db/firestore';
import {
  ModelConfigDto,
  OpenRouterModelCatalogItem,
  SelectableModel,
  SELECTABLE_MODELS,
  DEFAULT_MODEL_ID,
} from '@chat-monorepo/shared';

// Initial fallback mapping for known models to real OpenRouter slugs
const LEGACY_SLUG_MAP: Record<string, string> = {
  'gemini-flash-latest': 'google/gemini-2.5-flash',
  'gemini-pro-latest': 'google/gemini-2.5-pro',
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'claude-sonnet': 'anthropic/claude-sonnet-5',
  'llama-4-maverick': 'meta-llama/llama-4-maverick',
  grok: 'x-ai/grok-4.6',
  'omniroute-default': 'google/gemini-2.5-flash',
};

// Initial fallback costs per 1K tokens ($/1K)
const DEFAULT_COST_MAP: Record<string, { prompt: number; completion: number }> = {
  'gemini-flash-latest': { prompt: 0.00015, completion: 0.0006 },
  'gemini-pro-latest': { prompt: 0.00125, completion: 0.005 },
  'gpt-4o': { prompt: 0.0025, completion: 0.01 },
  'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
  'claude-sonnet': { prompt: 0.003, completion: 0.015 },
  'llama-4-maverick': { prompt: 0.0002, completion: 0.0008 },
  grok: { prompt: 0.003, completion: 0.015 },
  'omniroute-default': { prompt: 0.00015, completion: 0.0006 },
};

const DEFAULT_FALLBACK_COST = { prompt: 0.001, completion: 0.003 };

/**
 * Default daily-per-user cap for the seeded models, keyed by id - "costly
 * model can be used limited" out of the box, without an admin having to
 * configure anything first. Undefined/absent = unlimited. Purely a seed:
 * fully admin-editable afterward via saveModelConfig (see models-view.
 * component.ts in the admin console).
 */
const DEFAULT_DAILY_LIMIT_MAP: Record<string, number> = {
  'gpt-4o': 5,
  'claude-sonnet': 5,
  'gemini-pro-latest': 8,
  grok: 5,
};

export class ModelConfigService {
  private static readonly SETTINGS_COLLECTION = 'settings';
  private static readonly MODEL_CONFIG_DOC = 'model_config';

  // In-memory cache for fast read during LLM streaming turns
  private static cachedConfig: ModelConfigDto | null = null;
  private static cachedConfigTimestamp = 0;
  private static readonly CONFIG_CACHE_TTL_MS = 60 * 1000; // 1 minute

  // OpenRouter catalog cache
  private static cachedCatalog: OpenRouterModelCatalogItem[] | null = null;
  private static cachedCatalogTimestamp = 0;
  private static readonly CATALOG_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

  /**
   * Returns the active model configuration.
   * Reads from Firestore (with in-memory caching), or returns seeded default config if not yet created.
   */
  public static async getModelConfig(): Promise<ModelConfigDto> {
    const now = Date.now();
    if (this.cachedConfig && now - this.cachedConfigTimestamp < this.CONFIG_CACHE_TTL_MS) {
      return this.cachedConfig;
    }

    try {
      const doc = await firestore.collection(this.SETTINGS_COLLECTION).doc(this.MODEL_CONFIG_DOC).get();
      if (doc.exists) {
        const data = doc.data() as ModelConfigDto;
        if (data && Array.isArray(data.models) && data.models.length > 0) {
          this.cachedConfig = data;
          this.cachedConfigTimestamp = now;
          return data;
        }
      }
    } catch (error) {
      console.warn('[ModelConfigService] Failed to read model config from Firestore, using default:', error);
    }

    // Default seeded configuration
    const defaultConfig: ModelConfigDto = {
      defaultModel: DEFAULT_MODEL_ID,
      models: (SELECTABLE_MODELS as SelectableModel[]).map((m) => ({
        ...m,
        pricing: DEFAULT_COST_MAP[m.id] || DEFAULT_FALLBACK_COST,
        dailyLimitPerUser: DEFAULT_DAILY_LIMIT_MAP[m.id] ?? null,
      })),
      updatedAt: Date.now(),
    };

    this.cachedConfig = defaultConfig;
    this.cachedConfigTimestamp = now;
    return defaultConfig;
  }

  /**
   * Saves updated model configuration to Firestore and refreshes cache.
   */
  public static async saveModelConfig(config: Partial<ModelConfigDto>): Promise<ModelConfigDto> {
    const existing = await this.getModelConfig();

    const updatedModels: SelectableModel[] = Array.isArray(config.models)
      ? config.models.map((m) => ({
          id: String(m.id).trim(),
          name: String(m.name || m.id).trim(),
          provider: m.provider ? String(m.provider).trim() : this.inferProvider(m.id),
          description: m.description ? String(m.description).trim() : undefined,
          contextLength: typeof m.contextLength === 'number' ? m.contextLength : undefined,
          pricing: m.pricing
            ? {
                prompt: Number(m.pricing.prompt ?? (m.pricing as any).input ?? 0.001),
                completion: Number(m.pricing.completion ?? (m.pricing as any).output ?? 0.003),
              }
            : undefined,
          enabled: m.enabled !== false,
          dailyLimitPerUser:
            typeof m.dailyLimitPerUser === 'number' && m.dailyLimitPerUser > 0 ? Math.round(m.dailyLimitPerUser) : null,
        }))
      : existing.models;

    const defaultModel = config.defaultModel && updatedModels.some((m) => m.id === config.defaultModel)
      ? config.defaultModel
      : updatedModels.find((m) => m.enabled)?.id || updatedModels[0]?.id || DEFAULT_MODEL_ID;

    const fullConfig: ModelConfigDto = {
      defaultModel,
      models: updatedModels,
      updatedAt: Date.now(),
    };

    await firestore.collection(this.SETTINGS_COLLECTION).doc(this.MODEL_CONFIG_DOC).set(fullConfig);

    this.cachedConfig = fullConfig;
    this.cachedConfigTimestamp = Date.now();

    return fullConfig;
  }

  /**
   * Fetches the live model catalog from OpenRouter (cached in-memory).
   */
  public static async fetchOpenRouterCatalog(forceRefresh = false): Promise<OpenRouterModelCatalogItem[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedCatalog && now - this.cachedCatalogTimestamp < this.CATALOG_CACHE_TTL_MS) {
      return this.cachedCatalog;
    }

    try {
      const apiKey = process.env.OPENROUTER_API_KEY || '';
      const headers: Record<string, string> = {};
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const res = await fetch('https://openrouter.ai/api/v1/models', { headers });
      if (!res.ok) {
        throw new Error(`OpenRouter models API returned HTTP ${res.status}`);
      }

      const data = (await res.json()) as { data: OpenRouterModelCatalogItem[] };
      if (data && Array.isArray(data.data)) {
        this.cachedCatalog = data.data;
        this.cachedCatalogTimestamp = now;
        return data.data;
      }
      return [];
    } catch (error) {
      console.error('[ModelConfigService] Failed to fetch OpenRouter catalog:', error);
      if (this.cachedCatalog) return this.cachedCatalog;
      return [];
    }
  }

  /**
   * Resolves a client model ID to the real OpenRouter model slug.
   * If the model ID is already a full slug (e.g. 'anthropic/claude-3.5-sonnet'), returns it directly.
   * Otherwise checks config or legacy slug map.
   */
  public static resolveModelSlug(modelId: string): string {
    if (!modelId) return LEGACY_SLUG_MAP[DEFAULT_MODEL_ID] || 'google/gemini-2.5-flash';

    // If it contains a slash, it's already a provider/model slug (e.g. 'openai/gpt-4o')
    if (modelId.includes('/')) {
      return modelId;
    }

    // Check legacy map
    if (LEGACY_SLUG_MAP[modelId]) {
      return LEGACY_SLUG_MAP[modelId];
    }

    return modelId;
  }

  /**
   * Gets cost rate in USD per 1K tokens for a given model.
   */
  public static getCostRate(modelId: string): { input: number; output: number } {
    if (DEFAULT_COST_MAP[modelId]) {
      return {
        input: DEFAULT_COST_MAP[modelId].prompt,
        output: DEFAULT_COST_MAP[modelId].completion,
      };
    }

    if (this.cachedConfig?.models) {
      const found = this.cachedConfig.models.find((m) => m.id === modelId);
      if (found?.pricing) {
        return {
          input: found.pricing.prompt ?? DEFAULT_FALLBACK_COST.prompt,
          output: found.pricing.completion ?? DEFAULT_FALLBACK_COST.completion,
        };
      }
    }

    return { input: DEFAULT_FALLBACK_COST.prompt, output: DEFAULT_FALLBACK_COST.completion };
  }

  private static inferProvider(id: string): string {
    if (id.startsWith('google/') || id.includes('gemini')) return 'Google';
    if (id.startsWith('openai/') || id.includes('gpt')) return 'OpenAI';
    if (id.startsWith('anthropic/') || id.includes('claude')) return 'Anthropic';
    if (id.startsWith('meta-llama/') || id.includes('llama')) return 'Meta';
    if (id.startsWith('mistralai/') || id.includes('mistral')) return 'Mistral';
    if (id.startsWith('x-ai/') || id.includes('grok')) return 'xAI';
    if (id.startsWith('deepseek/') || id.includes('deepseek')) return 'DeepSeek';
    if (id.startsWith('qwen/') || id.includes('qwen')) return 'Qwen';
    if (id.startsWith('cohere/') || id.includes('command')) return 'Cohere';
    return 'Custom';
  }
}
