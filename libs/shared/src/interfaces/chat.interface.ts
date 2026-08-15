export type AIModelType = 'gemini-1.5-pro' | 'gemini-1.5-flash' | 'gpt-4o' | 'gpt-4o-mini';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  model?: AIModelType;
  error?: boolean;
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
}
