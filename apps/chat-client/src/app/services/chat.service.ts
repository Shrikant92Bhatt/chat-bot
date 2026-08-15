import { Injectable, signal, computed } from '@angular/core';
import { AIModelType, ChatMessage, ChatThread } from '@chat-monorepo/shared';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root',
})
export class ChatService {
  private apiUrl = 'http://localhost:3000/api/chat';

  public selectedModel = signal<AIModelType>('gemini-1.5-flash');
  public threads = signal<ChatThread[]>([]);
  public activeThreadId = signal<string | null>(null);
  public isStreaming = signal<boolean>(false);
  public mcpEnabled = signal<boolean>(false);

  public activeThread = computed(() => {
    const id = this.activeThreadId();
    return this.threads().find((t) => t.id === id) || null;
  });

  public activeMessages = computed(() => {
    return this.activeThread()?.messages || [];
  });

  private abortController: AbortController | null = null;

  constructor(private authService: AuthService) {
    this.createInitialThread();
  }

  public createInitialThread() {
    const initialThread: ChatThread = {
      id: 'thread-' + Date.now(),
      title: 'Enterprise Architecture & Multi-LLM Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: this.selectedModel(),
      messages: [
        {
          id: 'welcome-msg',
          role: 'assistant',
          content: 'Hello! I am NexusAI, powered by Google Gemini and OpenAI. Ask me anything about multi-LLM routing, Glassmorphism UI, or GCP monorepo architecture.',
          timestamp: Date.now(),
          model: 'gemini-1.5-flash',
        },
      ],
    };

    this.threads.set([initialThread]);
    this.activeThreadId.set(initialThread.id);
  }

  public selectThread(threadId: string) {
    this.activeThreadId.set(threadId);
  }

  public createNewThread() {
    const newThread: ChatThread = {
      id: 'thread-' + Date.now(),
      title: 'New Chat Thread',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: this.selectedModel(),
      messages: [],
    };

    this.threads.update((curr) => [newThread, ...curr]);
    this.activeThreadId.set(newThread.id);
  }

  public setModel(model: AIModelType) {
    this.selectedModel.set(model);
  }

  public toggleMcp() {
    this.mcpEnabled.update((v) => !v);
  }

  async sendMessage(userContent: string): Promise<void> {
    const currentThreadId = this.activeThreadId();
    if (!currentThreadId || !userContent.trim() || this.isStreaming()) return;

    const userMessage: ChatMessage = {
      id: 'msg-' + Date.now(),
      role: 'user',
      content: userContent.trim(),
      timestamp: Date.now(),
    };

    const assistantMessageId = 'msg-ai-' + Date.now();
    const assistantMessagePlaceholder: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      model: this.selectedModel(),
    };

    // Update state with User Message and Assistant Placeholder
    this.threads.update((threadsList) =>
      threadsList.map((t) => {
        if (t.id === currentThreadId) {
          const updatedTitle = t.messages.length === 0 ? userContent.slice(0, 30) + '...' : t.title;
          return {
            ...t,
            title: updatedTitle,
            updatedAt: Date.now(),
            messages: [...t.messages, userMessage, assistantMessagePlaceholder],
          };
        }
        return t;
      })
    );

    this.isStreaming.set(true);
    this.abortController = new AbortController();

    try {
      const activeThread = this.activeThread();
      const contextMessages = (activeThread?.messages || [])
        .filter((m) => m.id !== assistantMessageId)
        .map((m) => ({ role: m.role, content: m.content }));

      const response = await fetch(`${this.apiUrl}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authService.getIdToken()}`,
        },
        body: JSON.stringify({
          messages: contextMessages,
          model: this.selectedModel(),
          temperature: 0.7,
          mcpEnabled: this.mcpEnabled(),
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder('utf-8');

      if (!reader) throw new Error('Response body reader is null.');

      let accumulatedContent = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunkText = decoder.decode(value, { stream: true });
        const lines = chunkText.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.error) {
                accumulatedContent += `\n⚠️ Error: ${data.error}`;
              } else if (data.chunk) {
                accumulatedContent += data.chunk;
              }

              // Update assistant message state
              this.updateAssistantMessage(currentThreadId, assistantMessageId, accumulatedContent);
            } catch (e) {
              // Ignore partial chunk parse failures
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('[ChatService] Stream Error:', error);
        this.updateAssistantMessage(
          currentThreadId,
          assistantMessageId,
          `⚠️ Failed to stream response from backend. Details: ${error.message}`
        );
      }
    } finally {
      this.isStreaming.set(false);
      this.abortController = null;
    }
  }

  public stopStreaming() {
    if (this.abortController) {
      this.abortController.abort();
      this.isStreaming.set(false);
    }
  }

  private updateAssistantMessage(threadId: string, messageId: string, content: string) {
    this.threads.update((threadsList) =>
      threadsList.map((t) => {
        if (t.id === threadId) {
          const updatedMessages = t.messages.map((m) => {
            if (m.id === messageId) {
              return { ...m, content };
            }
            return m;
          });
          return { ...t, messages: updatedMessages };
        }
        return t;
      })
    );
  }
}
