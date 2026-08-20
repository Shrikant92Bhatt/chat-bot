export type AIModelType = string;

export interface SelectableModel {
  id: string;
  name: string;
  provider?: string;
  description?: string;
  contextLength?: number;
  pricing?: {
    prompt: number; // USD per 1,000 tokens
    completion: number; // USD per 1,000 tokens
  };
  enabled?: boolean;
}

export interface ModelConfigDto {
  defaultModel: string;
  models: SelectableModel[];
  updatedAt?: number;
}

export interface OpenRouterModelCatalogItem {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
    instruct_type?: string | null;
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    image?: string;
    request?: string;
  };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
}

/** Fallback list for the model picker UI when dynamic database config is not yet loaded. */
export const SELECTABLE_MODELS: ReadonlyArray<SelectableModel> = [
  { id: 'gemini-flash-latest', name: 'Gemini Flash', provider: 'Google', description: 'Fast, lightweight & responsive', enabled: true },
  { id: 'gemini-pro-latest', name: 'Gemini Pro', provider: 'Google', description: 'Advanced reasoning & large context', enabled: true },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', description: 'Flagship multimodal model', enabled: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI', description: 'Affordable, fast intelligent model', enabled: true },
  { id: 'claude-sonnet', name: 'Claude Sonnet 5', provider: 'Anthropic', description: 'Balanced reasoning & speed', enabled: true },
  { id: 'llama-4-maverick', name: 'Llama 4 Maverick', provider: 'Meta', description: 'Open-weight, large context', enabled: true },
  { id: 'grok', name: 'Grok 4.6', provider: 'xAI', description: 'Real-time, unfiltered reasoning', enabled: true },
];

export const DEFAULT_MODEL_ID = 'gemini-flash-latest';

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
  /** Project this conversation is scoped to (project instructions + project files are injected into context). */
  projectId?: string | null;
  /**
   * Rolling LLM-generated summary of the messages that have been dropped
   * from the live context window. Written server-side by
   * SummarizationService; the client persists it back verbatim.
   */
  summary?: string | null;
  /** Number of leading messages of `messages` that `summary` already covers. */
  summarizedThroughIndex?: number;
  summaryUpdatedAt?: number;
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
  /** Thread id — lets the backend persist/reuse a conversation summary for
   *  this thread, and is what usage/cost records (see
   *  services/usage.service.ts) are attributed to. Optional - older
   *  clients that don't send it just get a null conversationId logged. */
  threadId?: string;
  /** When set, project instructions + project-scoped RAG documents are injected into context. */
  projectId?: string | null;
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

/** A user workspace: custom instructions + its own scoped file/knowledge set. */
export interface Project {
  id: string;
  ownerId: string;
  name: string;
  /** Custom instructions injected into every conversation scoped to this project. */
  instructions: string;
  createdAt: number;
  updatedAt: number;
  fileCount: number;
}

/** Metadata for a file ingested into a project's knowledge base. */
export interface ProjectFile {
  id: string;
  projectId: string;
  fileName: string;
  characters: number;
  uploadedAt: number;
  /** GCS object URL, when GCS is configured. */
  storageUrl?: string | null;
}

export type ProjectListResponse = { projects: Project[] };
export type ProjectFileListResponse = { files: ProjectFile[] };

/** Durable, user-level fact/preference remembered across conversations. */
export type MemoryKind = 'identity' | 'preference' | 'fact' | 'instruction';

export interface MemoryEntry {
  id: string;
  userId: string;
  content: string;
  kind: MemoryKind;
  createdAt: number;
  updatedAt: number;
  /** Thread the memory was extracted from, for provenance. */
  sourceThreadId?: string | null;
}

export interface UserSession {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  idToken: string;
  /** Display/UX only - e.g. whether to show the Admin entry point. Never
   *  the authorization boundary; every admin API call re-reads the role
   *  fresh from Firestore server-side regardless of what this says. */
  role?: 'user' | 'admin';
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
