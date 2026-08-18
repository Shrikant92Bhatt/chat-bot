import { Injectable, signal, computed, effect } from '@angular/core';
import { AIModelType, ChatMessage, ChatThread } from '@chat-monorepo/shared';
import { AuthService } from './auth.service';
import { getApiBaseUrl } from '../core/runtime-config';

@Injectable({
  providedIn: 'root',
})
export class ChatService {
  private get apiUrl() {
    return `${getApiBaseUrl()}/api/chat`;
  }

  public selectedModel = signal<AIModelType>('gemini-1.5-flash');
  public threads = signal<ChatThread[]>([]);
  public activeThreadId = signal<string | null>(null);
  public isStreaming = signal<boolean>(false);
  public mcpEnabled = signal<boolean>(false);

  // Tracks unauthenticated user message limit (Max 1 message allowed without sign-in)
  public unauthUserMessageCount = signal<number>(0);

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

    // Effect: Reacts to User Login/Logout state changes
    effect(
      () => {
        const user = this.authService.userSignal();
        if (user && user.uid) {
          this.loadUserThreadHistory();
        } else {
          this.clearUnauthenticatedHistory();
        }
      },
      // clearUnauthenticatedHistory/createInitialThread write signals (threads,
      // unauthUserMessageCount) owned by this same service, which Angular
      // disallows from inside an effect by default (NG0600) unless opted in.
      { allowSignalWrites: true }
    );
  }

  private clearUnauthenticatedHistory() {
    this.unauthUserMessageCount.set(0);
    this.createInitialThread();
  }

  /**
   * Loads saved chat history from the backend (Postgres) for authenticated users.
   */
  private async loadUserThreadHistory(): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/threads`, {
        headers: { Authorization: `Bearer ${this.authService.getIdToken()}` },
      });

      if (response.status === 401) {
        this.authService.notifySessionExpired();
        return;
      }

      if (response.ok) {
        const data = await response.json();
        const loadedThreads: ChatThread[] = data.threads;
        if (loadedThreads && loadedThreads.length > 0) {
          this.threads.set(loadedThreads);
          this.activeThreadId.set(loadedThreads[0].id);
          return;
        }
      }
    } catch (e) {
      console.error('[ChatService] Failed to load thread history:', e);
    }
    this.createInitialThread();
  }

  /**
   * Saves thread history for authenticated users ONLY.
   */
  private async persistUserThreadHistory(): Promise<void> {
    const user = this.authService.userSignal();
    if (!user || !user.uid) return;

    try {
      const response = await fetch(`${this.apiUrl}/threads`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authService.getIdToken()}`,
        },
        body: JSON.stringify({ threads: this.threads() }),
      });

      if (response.status === 401) {
        this.authService.notifySessionExpired();
      }
    } catch (e) {
      console.error('[ChatService] Failed to save thread history:', e);
    }
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
          content: "Hello! I'm NexusAI, your intelligent assistant. Ask me anything — I'm here to help with questions, ideas, writing, and code.",
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
    this.persistUserThreadHistory();
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

    // Enforce 1 message limit for unauthenticated users
    const isAuthenticated = !!this.authService.userSignal();
    if (!isAuthenticated && this.unauthUserMessageCount() >= 1) {
      this.appendSystemNoticeMessage(
        currentThreadId,
        '🔒 Free trial limit reached (1 message without sign-in). Please sign in with Google to continue chatting.'
      );
      this.authService.loginWithGoogle();
      return;
    }

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
          const updatedTitle = t.messages.length <= 1 ? userContent.slice(0, 30) + '...' : t.title;
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

    if (!isAuthenticated) {
      this.unauthUserMessageCount.update((count) => count + 1);
    } else {
      this.persistUserThreadHistory();
    }

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

      if (response.status === 401) {
        // Expired Google ID token or trial limit reached. Show a popup with an
        // explicit Sign In button rather than auto-triggering Google's flow here -
        // this fetch callback runs outside a direct user click, so calling it
        // straight away is liable to be blocked by the browser's popup blocker.
        this.authService.notifySessionExpired();
        this.updateAssistantMessage(
          currentThreadId,
          assistantMessageId,
          '🔒 Your session has expired. Please sign in again to continue.'
        );
        return;
      }

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
              }

              if (data.toolCall) {
                accumulatedContent += `\n\n> 🔧 Using **${data.toolCall.name}**...\n\n`;
              }

              if (data.chunk) {
                accumulatedContent += data.chunk;
              }

              this.updateAssistantMessage(currentThreadId, assistantMessageId, accumulatedContent);

              if (data.done && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
                this.setMessageSuggestions(currentThreadId, assistantMessageId, data.suggestions);
              }
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
      if (isAuthenticated) {
        this.persistUserThreadHistory();
      }
    }
  }

  public stopStreaming() {
    if (this.abortController) {
      this.abortController.abort();
      this.isStreaming.set(false);
    }
  }

  private appendSystemNoticeMessage(threadId: string, noticeContent: string) {
    const noticeMessage: ChatMessage = {
      id: 'notice-' + Date.now(),
      role: 'assistant',
      content: noticeContent,
      timestamp: Date.now(),
      model: this.selectedModel(),
    };

    this.threads.update((threadsList) =>
      threadsList.map((t) => {
        if (t.id === threadId) {
          return {
            ...t,
            messages: [...t.messages, noticeMessage],
          };
        }
        return t;
      })
    );
  }

  private setMessageSuggestions(threadId: string, messageId: string, suggestions: string[]) {
    this.threads.update((threadsList) =>
      threadsList.map((t) => {
        if (t.id === threadId) {
          const updatedMessages = t.messages.map((m) => (m.id === messageId ? { ...m, suggestions } : m));
          return { ...t, messages: updatedMessages };
        }
        return t;
      })
    );
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
