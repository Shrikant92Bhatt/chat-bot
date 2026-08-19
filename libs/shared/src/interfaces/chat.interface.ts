export type AIModelType =
  | 'gemini-pro-latest'
  | 'gemini-flash-latest'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'claude-sonnet'
  | 'llama-4-maverick'
  | 'grok'
  | 'omniroute-default';

/** Single source of truth for the model picker UI - avoids the id/label pairs drifting out of sync between components. */
export const SELECTABLE_MODELS: ReadonlyArray<{ id: AIModelType; name: string }> = [
  { id: 'gemini-flash-latest', name: 'Gemini Flash' },
  { id: 'gemini-pro-latest', name: 'Gemini Pro' },
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'claude-sonnet', name: 'Claude Sonnet 5' },
  { id: 'llama-4-maverick', name: 'Llama 4 Maverick' },
  { id: 'grok', name: 'Grok 4.6' },
];

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  model?: AIModelType;
  error?: boolean;
  /** Suggested follow-up questions, attached to the final assistant message of a turn. */
  suggestions?: string[];
  imageUrl?: string;
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  model: AIModelType;
}

export interface ChatStreamRequest {
  messages: Array<{
    role: MessageRole;
    content: string;
  }>;
  model: AIModelType;
  temperature?: number;
  mcpEnabled?: boolean;
  ragContext?: string[];
  /** Client-side thread id, used to attribute usage/cost records (see
   *  services/usage.service.ts) to a conversation. Optional - older
   *  clients that don't send it just get a null conversationId logged. */
  conversationId?: string;
}

/** One row logged per completed chat request - see
 *  apps/chat-api/src/services/usage.service.ts (UsageRecord) for the
 *  server-side source of truth this mirrors, and GET /api/chat/usage. */
export interface UsageRecordDto {
  requestId: string;
  userId: string | null;
  tenantId: string | null;
  conversationId: string | null;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  estimatedCostUsd: number | null;
  timestamp: number;
}

export interface UserSession {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  idToken: string;
}

export interface AIProviderResponse {
  chunk: string;
  done: boolean;
  model: AIModelType;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  /** Follow-up question suggestions, sent once on the final (done: true) event. */
  suggestions?: string[];
  /** Emitted when the model invokes an MCP tool mid-turn, before the tool's result is streamed back. */
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  /** Set when a generate_image tool call produced an image this turn. */
  imageUrl?: string;
}

export interface StorageMetricsResponse {
  bucketName: string;
  totalSizeBytes: number;
  totalSizeMB: string;
  totalSizeGB: string;
  objectCount: number;
  estimatedMonthlyCostUSD: string;
  lastUpdated: string;
  configured: boolean;
}

export interface ImageGenerationRequest {
  prompt: string;
  style?: string;
  model?: AIModelType;
}

export interface ImageGenerationResponse {
  success: boolean;
  imageUrl: string;
  prompt: string;
  storagePath?: string;
  generatedAt: number;
}

export interface SystemDiagnostics {
  mcpAdapter: { status: 'ready' | 'offline'; toolCount: number };
  ragEngine: { status: 'active' | 'offline'; vectorDbConnected: boolean };
  omniRoute: { status: 'connected' | 'offline'; baseUrl: string };
  gcsStorage: { status: 'connected' | 'offline'; bucketName: string };
}
