import { Injectable, signal, computed, effect } from '@angular/core';
import { AIModelType, ChatMessage, ChatThread } from '@chat-monorepo/shared';
import { AuthService } from './auth.service';
import { getApiBaseUrl } from '../core/runtime-config';

@Injectable({
  providedIn: 'root',
})
export class ChatService {
  private apiUrl = `${getApiBaseUrl()}/api/chat`;

  public selectedModel = signal<AIModelType>('gemini-1.5-flash');
  public threads = signal<ChatThread[]>([]);
  public activeThreadId = signal<string | null>(null);
  public isStreaming = signal<boolean>(false);
  public mcpEnabled = signal<boolean>(false);

  // Tracks unauthenticated user message limit (Max 1 message allowed without sign-in).
  // Persisted so a page reload can't be used to bypass the limit; the backend
  // separately enforces this per-IP as the authoritative source of truth.
  public unauthUserMessageCount = signal<number>(
    parseInt(localStorage.getItem('NEXUS_ANON_MSG_COUNT') || '0', 10) || 0
  );

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
    effect(() => {
      const user = this.authService.userSignal();
      if (user && user.uid) {
        // Authenticated user: Load saved user thread history
        this.loadUserThreadHistory(user.uid);
      } else {
        // Unauthenticated user: Do NOT preserve chat history
        this.clearUnauthenticatedHistory();
      }
    });
  }

  /**
   * Clears threads for unauthenticated users (chat history is never persisted
   * for anonymous visitors). Does NOT reset unauthUserMessageCount - that
   * stays persisted across reload/logout so the free-trial limit holds.
   */
  private clearUnauthenticatedHistory() {
    this.createInitialThread();
  }

  /**
   * Loads saved chat history from localStorage for authenticated users.
   */
  private loadUserThreadHistory(uid: string) {
    const saved = localStorage.getItem(`NEXUS_THREADS_${uid}`);
    if (saved) {
      try {
        const loadedThreads: ChatThread[] = JSON.parse(saved);
        if (loadedThreads && loadedThreads.length > 0) {
          this.threads.set(loadedThreads);
          this.activeThreadId.set(loadedThreads[0].id);
          return;
        }
      } catch (e) {
        localStorage.removeItem(`NEXUS_THREADS_${uid}`);
      }
    }
    this.createInitialThread();
  }

  /**
   * Saves thread history for authenticated users ONLY.
   */
  private persistUserThreadHistory() {
    const user = this.authService.userSignal();
    if (user && user.uid) {
      localStorage.setItem(`NEXUS_THREADS_${user.uid}`, JSON.stringify(this.threads()));
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
      this.unauthUserMessageCount.update((count) => {
        const next = count + 1;
        localStorage.setItem('NEXUS_ANON_MSG_COUNT', String(next));
        return next;
      });
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
        // Server-side (IP-based) trial check disagrees with our local count -
        // e.g. storage was cleared, or the limit was already used from this
        // network. Sync local state to match and prompt sign-in.
        this.unauthUserMessageCount.set(1);
        localStorage.setItem('NEXUS_ANON_MSG_COUNT', '1');
        this.updateAssistantMessage(
          currentThreadId,
          assistantMessageId,
          '🔒 Free trial limit reached (1 message without sign-in). Please sign in with Google to continue chatting.'
        );
        this.authService.loginWithGoogle();
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
