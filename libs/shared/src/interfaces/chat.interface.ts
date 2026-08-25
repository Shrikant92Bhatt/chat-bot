import { UIComponent, OrchestratorSource, OrchestratorAction } from './orchestrator.interface';
import { ResearchTrace } from './research.interface';

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
  /** Admin-set daily-per-user cap for this model (see
   *  apps/chat-api/src/orchestration/graph.ts) - undefined/null means
   *  unlimited. Costly models default to a cap; cheap ones don't. Hitting
   *  it never blocks a request outright: the turn falls back to a cheaper
   *  model instead (see AIProviderResponse.modelSwitch below). */
  dailyLimitPerUser?: number | null;
  /** Populated only on GET /api/chat/models for an AUTHENTICATED caller -
   *  this model's current standing against dailyLimitPerUser for THAT
   *  user, so the picker can grey it out before they even try it. Absent
   *  for unlimited models and for unauthenticated requests. */
  usage?: {
    disabled: boolean;
    resetAt: number;
  };
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

/** 'image' attachments are sent to the model as vision input (see
 *  apps/chat-api/src/orchestration/graph.ts toMessageContent()); 'video'
 *  attachments are stored and shown in the chat only - no model today in
 *  this app's gateway can actually watch/understand a video. */
export type AttachmentKind = 'image' | 'video';

/** A photo or video attached to a chat message. Uploaded via
 *  POST /api/chat/attachments (see chat.routes.ts), which returns these
 *  already-hosted (GCS) so the client never sends raw file bytes as part
 *  of a chat turn. */
export interface ChatAttachment {
  id: string;
  kind: AttachmentKind;
  url: string;
  contentType: string;
  fileName: string;
  sizeBytes?: number;
}

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
  /** Photos/videos the user attached to this message, if any. */
  attachments?: ChatAttachment[];
  /**
   * Approved interactive UI components the orchestrator attached to this
   * reply (weather/stock cards, tables, charts, ...). Parsed and validated
   * server-side — see apps/chat-api/src/orchestration/ui-schema.ts. Empty
   * or absent for the overwhelming majority of replies, which are plain
   * text/Markdown.
   */
  ui?: UIComponent[];
  /** Sources cited for this reply's `ui` payload, if any. */
  sources?: OrchestratorSource[];
  /** Suggested follow-up actions tied to this reply's `ui` payload, if any. */
  actions?: OrchestratorAction[];
  /**
   * How this reply was researched — the planner's reasoning, the queries it
   * ran and what they returned. Present only on turns where the research
   * node engaged (or explained why it didn't); rendered as the collapsible
   * "Thinking" panel above the answer.
   */
  research?: ResearchTrace;
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
    attachments?: ChatAttachment[];
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
  /** Opt-in deep research: always plan (skipping the recency heuristic) and
   *  allow a wider search fan-out. See apps/chat-api/src/orchestration/research.ts.
   *  Requires mcpEnabled - with tools off there is no search backend to plan for. */
  deepResearch?: boolean;
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
  /** Approved UI components attached to this reply, sent once on the final (done: true) event. */
  ui?: UIComponent[];
  /** Sources for the `ui` payload, sent once on the final (done: true) event. */
  sources?: OrchestratorSource[];
  /** Suggested follow-up actions for the `ui` payload, sent once on the final (done: true) event. */
  actions?: OrchestratorAction[];
  /**
   * Set once, on the final (done: true) event, when the requested model had
   * hit its daily-per-user cap and this turn was transparently served by a
   * cheaper model instead (see orchestration/graph.ts) - never a hard
   * error. `model` above already reflects the model actually used; this is
   * just the "why" for the UI to explain instead of a bare error.
   */
  modelSwitch?: {
    fromModel: AIModelType;
    toModel: AIModelType;
    resetAt: number;
  };
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
