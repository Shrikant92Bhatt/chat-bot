import { Injectable, signal, computed, effect } from '@angular/core';
import {
  AIModelType,
  ChatAttachment,
  ChatMessage,
  ChatThread,
  MessageRole,
  SelectableModel,
  SELECTABLE_MODELS,
  DEFAULT_MODEL_ID,
  UIComponent,
  OrchestratorSource,
  OrchestratorAction,
} from '@chat-monorepo/shared';
import { AuthService } from './auth.service';
import { getApiBaseUrl } from '../core/runtime-config';

@Injectable({
  providedIn: 'root',
})
export class ChatService {
  private get apiUrl() {
    return `${getApiBaseUrl()}/api/chat`;
  }

  public availableModels = signal<SelectableModel[]>([...SELECTABLE_MODELS]);
  public selectedModel = signal<AIModelType>(DEFAULT_MODEL_ID);
  public threads = signal<ChatThread[]>([]);
  public activeThreadId = signal<string | null>(null);
  // True only while the initial fetch of saved thread history is in flight
  // (including its one retry) - the sidebar shows a skeleton instead of a
  // misleadingly-empty list during this window.
  public isLoadingThreads = signal<boolean>(false);
  public isStreaming = signal<boolean>(false);
  // On by default so tool calls (image generation, calculator) work out of
  // the box - users can still switch it off in Settings.
  public mcpEnabled = signal<boolean>(true);

  // Tracks unauthenticated user message limit (Max 1 message allowed without sign-in)
  public unauthUserMessageCount = signal<number>(0);

  // Knowledge-base document upload state
  public isUploadingDocument = signal<boolean>(false);
  public uploadedDocuments = signal<string[]>([]);
  public documentUploadError = signal<string | null>(null);

  // Photo/video attachments staged for the NEXT message (composer chips) -
  // distinct from uploadedDocuments above, which join the RAG knowledge base
  // rather than riding along with a single turn. See attachMedia() below.
  public stagedAttachments = signal<ChatAttachment[]>([]);
  public isUploadingAttachments = signal<boolean>(false);
  public attachmentUploadError = signal<string | null>(null);

  private readonly MAX_ATTACHMENTS = 4;
  private readonly MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
  private readonly ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];
  private readonly ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

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
    void this.loadAvailableModels();

    // Effect: Reacts to User Login/Logout state changes
    effect(
      () => {
        const user = this.authService.userSignal();
        if (user && user.uid) {
          // Re-fetch models when user logs in so authenticated permissions / custom configs are fresh
          void this.loadAvailableModels();
          // loadUserThreadHistory() returns a promise that only settles once
          // its full retry chain finishes (each retry `return`s the next
          // call, so the chain of promises resolves together) - .finally()
          // here correctly waits for that whole chain, not just the first attempt.
          this.isLoadingThreads.set(true);
          this.loadUserThreadHistory().finally(() => this.isLoadingThreads.set(false));
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

  /**
   * Fetches dynamic model configuration from backend.
   */
  public async loadAvailableModels(): Promise<void> {
    try {
      const token = this.authService.getIdToken();
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${this.apiUrl}/models`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.models) && data.models.length > 0) {
          this.availableModels.set(data.models);
          if (data.defaultModel) {
            const current = this.selectedModel();
            const isCurrentAvailable = data.models.some((m: SelectableModel) => m.id === current);
            if (!isCurrentAvailable || current === DEFAULT_MODEL_ID) {
              this.selectedModel.set(data.defaultModel);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[ChatService] Could not fetch dynamic models list, using defaults:', e);
    }
  }

  private clearUnauthenticatedHistory() {
    this.unauthUserMessageCount.set(0);
    this.createInitialThread();
  }

  /**
   * Loads saved chat history from the backend for authenticated users. On a
   * transient failure (e.g. the API restarting), retries once before
   * falling back to a local-only thread - a dev server blip should never
   * make it look like saved history is gone. (The backend's save is also
   * now a pure upsert, so even a stale/partial local state can no longer
   * delete real data - this retry is about avoiding a misleading blank
   * screen, not data safety.)
   */
  private async loadUserThreadHistory(attempt = 1): Promise<void> {
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
          // Every fresh load starts a new chat rather than resuming the
          // last one - history is still there in the sidebar to pick up.
          // Not persisted until the user actually sends a message, so an
          // idle page load doesn't clutter saved history with empties.
          const freshThread: ChatThread = {
            id: 'thread-' + Date.now(),
            title: 'New Chat',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            model: this.selectedModel(),
            messages: [],
          };
          this.threads.set([freshThread, ...loadedThreads]);
          this.activeThreadId.set(freshThread.id);
          return;
        }
        // Genuinely confirmed empty (successful response, no saved threads) - fall through.
      } else if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return this.loadUserThreadHistory(attempt + 1);
      }
    } catch (e) {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return this.loadUserThreadHistory(attempt + 1);
      }
      console.error('[ChatService] Failed to load thread history:', e);
    }
    this.createInitialThread();
  }

  /**
   * Saves thread history for authenticated users ONLY.
   *
   * Only saves threads the user has actually sent something in. Without
   * this filter, every blank "New Chat" sitting in memory at save time
   * (one gets created on every reload, plus one per "New Chat" click) gets
   * persisted alongside whichever thread actually triggered the save -
   * this WAS the bug behind "multiple blank threads pile up on reload":
   * each reload's fresh blank thread would get saved the next time the
   * user sent any message anywhere, then the NEXT reload would fetch that
   * saved blank back AND add yet another fresh one on top, compounding
   * forever. A thread earns persistence the moment it has a real message,
   * not just by existing in memory.
   */
  private async persistUserThreadHistory(): Promise<void> {
    const user = this.authService.userSignal();
    if (!user || !user.uid) return;

    const threadsWorthSaving = this.threads().filter((t) => t.messages.some((m) => m.role === 'user'));

    try {
      const response = await fetch(`${this.apiUrl}/threads`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authService.getIdToken()}`,
        },
        body: JSON.stringify({ threads: threadsWorthSaving }),
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
          model: 'gemini-flash-latest',
        },
      ],
    };

    this.threads.set([initialThread]);
    this.activeThreadId.set(initialThread.id);
  }

  public selectThread(threadId: string) {
    this.activeThreadId.set(threadId);
  }

  /**
   * Starts a new conversation, optionally scoped to a project — the
   * project's custom instructions and its uploaded files are then injected
   * into every turn's context server-side.
   */
  public createNewThread(projectId: string | null = null) {
    // Reuse the current thread if it's already blank (no user message sent
    // yet) rather than stacking another empty "New Chat" on top of it -
    // clicking "New Chat" repeatedly, or switching a still-empty thread
    // into a project, shouldn't multiply blank entries in the sidebar.
    const current = this.activeThread();
    if (current && !current.messages.some((m) => m.role === 'user') && current.projectId === projectId) {
      return;
    }
    if (current && !current.messages.some((m) => m.role === 'user')) {
      this.threads.update((curr) => curr.map((t) => (t.id === current.id ? { ...t, projectId } : t)));
      return;
    }

    const newThread: ChatThread = {
      id: 'thread-' + Date.now(),
      title: 'New Chat Thread',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: this.selectedModel(),
      messages: [],
      projectId,
    };

    this.threads.update((curr) => [newThread, ...curr]);
    this.activeThreadId.set(newThread.id);
    this.persistUserThreadHistory();
  }

  /** Project the active conversation is scoped to, if any. */
  public activeProjectId = computed(() => this.activeThread()?.projectId ?? null);

  // Dedicated image-generation mode (separate from normal chat, like
  // ChatGPT/Gemini's image tool) - switches the composer's placeholder and
  // routes submissions straight to POST /generate-image instead of the
  // chat stream, so it doesn't depend on the model deciding to call a tool.
  public chatMode = signal<'chat' | 'image'>('chat');

  public setModel(model: AIModelType) {
    this.selectedModel.set(model);
  }

  public toggleMcp() {
    this.mcpEnabled.update((v) => !v);
  }

  public setChatMode(mode: 'chat' | 'image') {
    this.chatMode.set(mode);
  }

  /**
   * Uploads a file into the signed-in user's RAG knowledge base - future
   * chat turns automatically pull relevant excerpts from it as context
   * (see backend orchestration/graph.ts -> RagRetriever.retrieveContext).
   */
  async uploadDocument(file: File): Promise<void> {
    if (!this.authService.userSignal()) {
      this.documentUploadError.set('Sign in to attach files to your knowledge base.');
      return;
    }

    this.isUploadingDocument.set(true);
    this.documentUploadError.set(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${this.apiUrl}/documents`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.authService.getIdToken()}` },
        body: formData,
      });

      if (response.status === 401) {
        this.authService.notifySessionExpired();
        return;
      }

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Upload failed.');
      }

      this.uploadedDocuments.update((docs) => [...docs, data.fileName]);
    } catch (error: any) {
      console.error('[ChatService] Document upload failed:', error);
      this.documentUploadError.set(error.message || 'Failed to upload document.');
    } finally {
      this.isUploadingDocument.set(false);
    }
  }

  /**
   * Uploads up to MAX_ATTACHMENTS photos/videos and stages them for the next
   * sendMessage() call (composer chips, cleared once sent - see sendMessage
   * below). Images are later sent to the model as vision input; videos are
   * stored and shown in the chat only (see graph.ts toMessageContent()).
   */
  async attachMedia(files: File[]): Promise<void> {
    if (!this.authService.userSignal()) {
      this.attachmentUploadError.set('Sign in to attach photos or videos.');
      return;
    }
    if (files.length === 0) return;

    const room = this.MAX_ATTACHMENTS - this.stagedAttachments().length;
    if (room <= 0) {
      this.attachmentUploadError.set(`You can attach up to ${this.MAX_ATTACHMENTS} files per message.`);
      return;
    }

    const toUpload = files.slice(0, room);
    this.attachmentUploadError.set(
      files.length > toUpload.length ? `Only attaching the first ${toUpload.length} — max ${this.MAX_ATTACHMENTS} files per message.` : null
    );

    for (const file of toUpload) {
      const isImage = this.ALLOWED_IMAGE_TYPES.includes(file.type);
      const isVideo = this.ALLOWED_VIDEO_TYPES.includes(file.type);
      if (!isImage && !isVideo) {
        this.attachmentUploadError.set(
          `Unsupported file type "${file.type || file.name}". Supported: photos (jpg, png, webp, gif, heic) and video (mp4, mov, webm).`
        );
        return;
      }
      if (file.size > this.MAX_ATTACHMENT_BYTES) {
        this.attachmentUploadError.set(`"${file.name}" is too large — attachments must be ${this.MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB or smaller.`);
        return;
      }
    }

    this.isUploadingAttachments.set(true);
    try {
      const formData = new FormData();
      toUpload.forEach((file) => formData.append('files', file));

      const response = await fetch(`${this.apiUrl}/attachments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.authService.getIdToken()}` },
        body: formData,
      });

      if (response.status === 401) {
        this.authService.notifySessionExpired();
        return;
      }

      const data = await response.json();
      if (!response.ok || !Array.isArray(data.attachments)) {
        throw new Error(data.error || 'Failed to upload attachment(s).');
      }

      this.stagedAttachments.update((current) => [...current, ...data.attachments]);
    } catch (error: any) {
      console.error('[ChatService] Attachment upload failed:', error);
      this.attachmentUploadError.set(error.message || 'Failed to upload attachment(s).');
    } finally {
      this.isUploadingAttachments.set(false);
    }
  }

  public removeStagedAttachment(id: string): void {
    this.stagedAttachments.update((current) => current.filter((a) => a.id !== id));
  }

  async generateImage(prompt: string): Promise<void> {
    const currentThreadId = this.activeThreadId();
    if (!currentThreadId || !prompt.trim() || this.isStreaming()) return;

    const userMessage: ChatMessage = {
      id: 'msg-' + Date.now(),
      role: 'user',
      content: prompt.trim(),
      timestamp: Date.now(),
    };
    const assistantMessageId = 'msg-ai-' + Date.now();
    const assistantPlaceholder: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      model: this.selectedModel(),
    };

    const isAuthenticated = !!this.authService.userSignal();

    this.threads.update((threadsList) =>
      threadsList.map((t) => {
        if (t.id === currentThreadId) {
          const updatedTitle = t.messages.length <= 1 ? '🖼️ ' + prompt.trim().slice(0, 28) : t.title;
          return { ...t, title: updatedTitle, updatedAt: Date.now(), messages: [...t.messages, userMessage, assistantPlaceholder] };
        }
        return t;
      })
    );

    this.isStreaming.set(true);

    try {
      const response = await fetch(`${this.apiUrl}/generate-image`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.authService.getIdToken()}`,
        },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      if (response.status === 401) {
        this.authService.notifySessionExpired();
        this.updateAssistantMessage(currentThreadId, assistantMessageId, '🔒 Please sign in to generate images.');
        return;
      }

      const data = await response.json();
      if (response.ok && data.success && data.imageUrl) {
        this.setMessageImageUrl(currentThreadId, assistantMessageId, data.imageUrl);
      } else {
        this.updateAssistantMessage(currentThreadId, assistantMessageId, `⚠️ ${data.error || 'Image generation failed.'}`);
      }
    } catch (error: any) {
      console.error('[ChatService] Image generation error:', error);
      this.updateAssistantMessage(currentThreadId, assistantMessageId, `⚠️ Failed to generate image: ${error.message}`);
    } finally {
      this.isStreaming.set(false);
      if (isAuthenticated) {
        this.persistUserThreadHistory();
      }
    }
  }

  async sendMessage(userContent: string): Promise<void> {
    const currentThreadId = this.activeThreadId();
    const attachments = this.stagedAttachments();
    const hasText = !!userContent.trim();
    if (!currentThreadId || (!hasText && attachments.length === 0) || this.isStreaming()) return;

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
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    this.stagedAttachments.set([]);
    this.attachmentUploadError.set(null);

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
          const updatedTitle = t.messages.length <= 1 ? (hasText ? userContent.slice(0, 30) + '...' : '📎 Attachment') : t.title;
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

    const activeThread = this.activeThread();
    const contextMessages = (activeThread?.messages || [])
      .filter((m) => m.id !== assistantMessageId)
      .map((m) => ({ role: m.role, content: m.content, attachments: m.attachments }));

    await this.streamAssistantReply(currentThreadId, assistantMessageId, contextMessages, activeThread?.projectId ?? null);
  }

  /**
   * Re-runs the latest assistant reply against the same trailing user turn,
   * replacing it in place (ChatGPT/Gemini-style "Regenerate") rather than
   * appending a new message. Only ever regenerates the LAST assistant
   * message in the active thread - the UI only offers the control there
   * (see chat-window.component.html), since regenerating an older reply
   * would silently discard everything the user did after it.
   */
  async regenerateLastResponse(): Promise<void> {
    const currentThreadId = this.activeThreadId();
    if (!currentThreadId || this.isStreaming()) return;

    const thread = this.activeThread();
    if (!thread || thread.messages.length === 0) return;

    const lastMessage = thread.messages[thread.messages.length - 1];
    if (lastMessage.role !== 'assistant') return;

    const assistantMessageId = lastMessage.id;
    const contextMessages = thread.messages
      .filter((m) => m.id !== assistantMessageId)
      .map((m) => ({ role: m.role, content: m.content, attachments: m.attachments }));

    // Nothing to regenerate from without a preceding user turn (e.g. the
    // standalone welcome message in a fresh thread).
    if (contextMessages.length === 0 || contextMessages[contextMessages.length - 1].role !== 'user') return;

    // Reset the existing assistant message in place, keeping its id/position,
    // and drop everything a previous run of it attached (image, UI cards,
    // suggestions) so stale extras from the old reply don't linger.
    this.threads.update((threadsList) =>
      threadsList.map((t) =>
        t.id === currentThreadId
          ? {
              ...t,
              messages: t.messages.map((m) =>
                m.id === assistantMessageId
                  ? {
                      ...m,
                      content: '',
                      error: false,
                      imageUrl: undefined,
                      ui: undefined,
                      sources: undefined,
                      actions: undefined,
                      suggestions: undefined,
                    }
                  : m
              ),
            }
          : t
      )
    );

    await this.streamAssistantReply(currentThreadId, assistantMessageId, contextMessages, thread.projectId ?? null);
  }

  /**
   * The fetch + SSE-parsing loop shared by sendMessage and
   * regenerateLastResponse - both just prepare an assistant message id to
   * stream into and the trailing context to send, then hand off here.
   */
  private async streamAssistantReply(
    threadId: string,
    assistantMessageId: string,
    contextMessages: Array<{ role: MessageRole; content: string; attachments?: ChatAttachment[] }>,
    projectId: string | null
  ): Promise<void> {
    const isAuthenticated = !!this.authService.userSignal();
    this.isStreaming.set(true);
    this.abortController = new AbortController();

    try {
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
          // threadId lets the backend persist/reuse this thread's rolling
          // conversation summary instead of re-summarizing every turn, and is
          // what usage/cost records are attributed to; projectId pulls in
          // the project's instructions + files.
          threadId,
          projectId,
        }),
        signal: this.abortController.signal,
      });

      if (response.status === 401) {
        // Expired Google ID token or trial limit reached. Show a popup with an
        // explicit Sign In button rather than auto-triggering Google's flow here -
        // this fetch callback runs outside a direct user click, so calling it
        // straight away is liable to be blocked by the browser's popup blocker.
        this.authService.notifySessionExpired();
        this.updateAssistantMessage(threadId, assistantMessageId, '🔒 Your session has expired. Please sign in again to continue.');
        return;
      }

      if (response.status === 429) {
        // Daily message quota reached (see auth.middleware.ts authenticateOrAllowTrial /
        // AnonUsageService) - the backend already computed a friendly message and a
        // reset time, so show those instead of a bare "HTTP Error 429".
        let message = "You've reached your daily message limit. Please try again later.";
        try {
          const data = await response.json();
          if (data?.message) message = data.message;
          if (data?.resetAt) {
            message += ` (resets ${new Date(data.resetAt).toLocaleString()})`;
          }
        } catch {
          // Non-JSON or already-consumed body - fall back to the generic message above.
        }
        this.updateAssistantMessage(threadId, assistantMessageId, `⏳ ${message}`);
        return;
      }

      if (!response.ok) {
        let message = `HTTP Error ${response.status}: ${response.statusText}`;
        try {
          const data = await response.json();
          if (data?.message || data?.error) message = data.message || data.error;
        } catch {
          // Non-JSON or already-consumed body - fall back to the generic message above.
        }
        throw new Error(message);
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

              this.updateAssistantMessage(threadId, assistantMessageId, accumulatedContent);

              if (data.imageUrl) {
                this.setMessageImageUrl(threadId, assistantMessageId, data.imageUrl);
              }

              if (data.done && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
                this.setMessageSuggestions(threadId, assistantMessageId, data.suggestions);
              }

              if (data.done && Array.isArray(data.ui) && data.ui.length > 0) {
                this.setMessageUi(threadId, assistantMessageId, data.ui, data.sources, data.actions);
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
          threadId,
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

  /**
   * Formats a thread as a plain-text transcript for sharing - used by
   * shareActiveThread() below. Deliberately plain text (not Markdown/HTML):
   * the target is the OS share sheet / clipboard, not a renderer.
   */
  private formatThreadForSharing(thread: ChatThread): string {
    const lines = thread.messages
      .filter((m) => m.content && m.content.trim())
      .map((m) => `${m.role === 'user' ? 'You' : 'NexusAI'}: ${m.content.trim()}`);
    return `${thread.title}\n\n${lines.join('\n\n')}`;
  }

  /**
   * Shares the active conversation via the device's native share sheet
   * (navigator.share - Messages, Email, etc. on mobile). Falls back to
   * copying the transcript to the clipboard on browsers that don't support
   * it (most desktop browsers), returning 'copied' so the caller can show
   * its own confirmation - there's no share-sheet equivalent to confirm with
   * there.
   */
  public async shareActiveThread(): Promise<'shared' | 'copied' | 'cancelled' | 'unavailable'> {
    const thread = this.activeThread();
    if (!thread || !thread.messages.some((m) => m.role === 'user')) return 'unavailable';

    const text = this.formatThreadForSharing(thread);

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: thread.title, text });
        return 'shared';
      } catch (error: any) {
        // AbortError: the user closed the share sheet without picking a
        // target - not a failure, nothing to fall back to.
        if (error?.name === 'AbortError') return 'cancelled';
        console.warn('[ChatService] navigator.share failed, falling back to clipboard:', error);
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch (error) {
      console.error('[ChatService] Clipboard fallback for sharing also failed:', error);
      return 'unavailable';
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

  /**
   * Attaches the orchestrator's structured UI payload to a message, once,
   * on the final `done: true` SSE event - mirrors setMessageSuggestions.
   * `data.ui`/`sources`/`actions` are already validated server-side (see
   * apps/chat-api/src/orchestration/ui-schema.ts) so this just stores them.
   */
  private setMessageUi(
    threadId: string,
    messageId: string,
    ui: UIComponent[],
    sources?: OrchestratorSource[],
    actions?: OrchestratorAction[]
  ) {
    this.threads.update((threadsList) =>
      threadsList.map((t) => {
        if (t.id === threadId) {
          const updatedMessages = t.messages.map((m) => (m.id === messageId ? { ...m, ui, sources, actions } : m));
          return { ...t, messages: updatedMessages };
        }
        return t;
      })
    );
  }

  private setMessageImageUrl(threadId: string, messageId: string, imageUrl: string) {
    this.threads.update((threadsList) =>
      threadsList.map((t) => {
        if (t.id === threadId) {
          const updatedMessages = t.messages.map((m) => (m.id === messageId ? { ...m, imageUrl } : m));
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
