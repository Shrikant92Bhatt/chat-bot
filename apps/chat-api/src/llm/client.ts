import * as dotenv from 'dotenv';
import { ChatOpenAI } from '@langchain/openai';

dotenv.config();

/**
 * Maps the app's model IDs (AIModelType in libs/shared) to real OpenRouter
 * model slugs. Verified against OpenRouter's live /models catalog rather
 * than guessed — OpenRouter deprecates/renames slugs over time, so if a
 * request starts 404ing with "model not found", re-check
 * https://openrouter.ai/api/v1/models for the current slug.
 *
 * Only applies when OpenRouter is the active gateway (see getActiveGateway) —
 * the local OmniRoute dashboard app expects the app's own model IDs
 * unchanged (it does its own provider resolution from e.g. "gemini-flash-latest").
 */
const OPENROUTER_MODEL_SLUG_MAP: Record<string, string> = {
  'gemini-flash-latest': 'google/gemini-2.5-flash',
  'gemini-pro-latest': 'google/gemini-2.5-pro',
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'claude-sonnet': 'anthropic/claude-sonnet-5',
  'llama-4-maverick': 'meta-llama/llama-4-maverick',
  grok: 'x-ai/grok-4.6',
  'omniroute-default': 'google/gemini-2.5-flash',
};

/** Model used for the generate_image tool (OpenRouter's image-output models require `modalities: ["image","text"]`). Only valid on OpenRouter. */
export const IMAGE_GENERATION_MODEL = 'google/gemini-2.5-flash-image';

interface GatewayConfig {
  baseUrl: string;
  apiKey: string;
  isOpenRouter: boolean;
}

/**
 * OPENROUTER_API_KEY (real openrouter.ai) is preferred when set; otherwise
 * falls back to OMNIROUTE_API_KEY (a local/self-hosted OmniRoute gateway,
 * e.g. a dashboard app running at localhost:20128). Both can be configured
 * side by side - only one is used per request, chosen here.
 */
function getActiveGateway(): GatewayConfig {
  if (process.env.OPENROUTER_API_KEY) {
    return {
      baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
      apiKey: process.env.OPENROUTER_API_KEY,
      isOpenRouter: true,
    };
  }
  return {
    baseUrl: (process.env.OMNIROUTE_BASE_URL || 'http://localhost:20128/v1').replace(/\/$/, ''),
    apiKey: process.env.OMNIROUTE_API_KEY || 'sk-no-key-set',
    isOpenRouter: false,
  };
}

export function resolveOmniRouteModel(model: string): string {
  const gateway = getActiveGateway();
  return gateway.isOpenRouter ? OPENROUTER_MODEL_SLUG_MAP[model] || model : model;
}

export function isOmniRouteConfigured(): boolean {
  return !!(process.env.OPENROUTER_API_KEY || process.env.OMNIROUTE_API_KEY);
}

export function getOmniRouteBaseUrl(): string {
  return getActiveGateway().baseUrl;
}

export function getOmniRouteApiKey(): string {
  return getActiveGateway().apiKey;
}

export function isUsingOpenRouter(): boolean {
  return getActiveGateway().isOpenRouter;
}

/**
 * Builds a LangChain ChatOpenAI instance pointed at whichever gateway is
 * active (see getActiveGateway).
 */
export function createOmniRouteChatModel(model: string, temperature = 0.7): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: getOmniRouteApiKey(),
    model: resolveOmniRouteModel(model),
    temperature,
    streaming: true,
    configuration: { baseURL: getOmniRouteBaseUrl() },
  });
}

/**
 * Fallback mock generator used only when no gateway is configured at all,
 * so local development without credentials still produces a visible stream.
 */
export async function* mockStream(): AsyncGenerator<string> {
  const mockWords = ['This', ' is', ' a', ' mock', ' streaming', ' response', ' (set', ' OPENROUTER_API_KEY', ' for', ' live', ' output).'];
  for (const word of mockWords) {
    await new Promise((resolve) => setTimeout(resolve, 60));
    yield word;
  }
}
