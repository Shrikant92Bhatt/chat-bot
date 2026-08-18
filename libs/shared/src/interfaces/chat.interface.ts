export type AIModelType =
  | 'gemini-1.5-pro'
  | 'gemini-1.5-flash'
  | 'gemini-pro-latest'
  | 'gemini-flash-latest'
  | 'gpt-4o'
  | 'gpt-4o-mini';

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
}
