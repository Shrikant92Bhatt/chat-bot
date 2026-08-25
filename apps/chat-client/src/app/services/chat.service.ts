import { Injectable, signal, computed, effect } from '@angular/core';
import { Location } from '@angular/common';
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
  ResearchStreamEvent,
  ResearchTrace,
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
  /**
   * The id of the user message currently being edited via the composer, or
   * null when no edit is in progress. Only ever set on the LAST user
   * message in the active thread (see isLastUserMessage()/
   * startEditingMessage() below) - editing an earlier one is out of scope,
   * for the same reason regenerating an earlier assistant reply is: it
   * would invalidate summarizedThroughIndex, which assumes stable
   * message-array indices (see PROJECT_CONTEXT.md's Known gaps).
   */
  public editingMessageId = signal<string | null>(null);
  /**
   * What the backend is doing right now ("Searching the web", "Read 6
   * sources across 4 searches"). Research and tool round-trips all happen
   * before the first token exists, so without this the user watches an
   * idle spinner. Transient by design - cleared when the turn ends, and
   * never written into the message itself.
   */
  public activityStatus = signal<string | null>(null);
  /**
   * The in-flight research trace for the turn being streamed, rebuilt from
   * the events the backend emits (see libs/shared research.interface.ts).
   * Mirrored onto the assistant message when the turn ends, so the panel
   * can still be reopened later.
   */
  public activeResearchTrace = signal<ResearchTrace | null>(null);
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

  // The user's explicit "About you" text (Settings > Personalize), always
  // injected into the system prompt server-side - see MemoryService.
  // getProfile/setProfile. Distinct from the auto-extracted /memories list.
  public aboutMe = signal<string>('');
  public isSavingProfile = signal<boolean>(false);

  // Defaults mirror the backend's out-of-the-box values (see
  // system-limits.service.ts DEFAULT_LIMITS) - loadEffectiveLimits() below
  // overwrites these with whatever an admin has actually configured, so
  // client-side pre-validation never drifts from what the server enforces.
  public maxAttachments = signal<number>(4);
  public maxAttachmentBytes = signal<number>(25 * 1024 * 1024);
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

  // The thread id from the URL at page load (/chat/:id), consumed once by
  // loadUserThreadHistory() to resume that exact thread on reload instead of
  // always landing on a fresh blank one. Read before createInitialThread()
  // runs below so a reload's URL is captured before anything overwrites it.
  private pendingRouteThreadId: string | null = this.extractThreadIdFromUrl();

  private extractThreadIdFromUrl(): string | null {
    const match = window.location.pathname.match(/^\/chat\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  constructor(
    private authService: AuthService,
    private location: Location
  ) {
    this.createInitialThread();
    void this.loadAvailableModels();
    void this.loadEffectiveLimits();

    // Keeps the URL in sync with whichever thread is active - every path
    // that changes activeThreadId (selectThread, createNewThread, initial
    // load, history restore) runs through here rather than each call site
    // managing the URL itself. replaceState (not pushState/Router.navigate)
    // on purpose: the goal is "reload lands back on this chat", not a
    // browser-history entry per thread switch.
    effect(() => {
      const id = this.activeThreadId();
      if (id) this.location.replaceState(`/chat/${id}`);
    });

    // Effect: Reacts to User Login/Logout state changes
    effect(
      () => {
        const user = this.authService.userSignal();
        if (user && user.uid) {
          // Re-fetch models when user logs in so authenticated permissions / custom configs are fresh
          void this.loadAvailableModels();
          void this.loadProfile();
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

    // Editing the last user message only makes sense within the thread it
    // belongs to - clear any in-progress edit the moment the active thread
    // changes (thread switch, new thread, history load) so a stale edit
    // session can't leak its draft into a different conversation.
    effect(
      () => {
        this.activeThreadId();
        this.editingMessageId.set(null);
      },
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

  /** Loads the signed-in user's "About you" text into the aboutMe signal. */
  public async loadProfile(): Promise<void> {
    const token = this.authService.getIdToken();
    if (!token) return;
    try {
      const res = await fetch(`${this.apiUrl}/profile`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        this.aboutMe.set(data?.aboutMe || '');
      }
    } catch (e) {
      console.warn('[ChatService] Could not fetch profile:', e);
    }
  }

  /** Persists the "About you" text and injects it into future chat turns. */
  public async saveProfile(aboutMe: string): Promise<boolean> {
    const token = this.authService.getIdToken();
    if (!token) return false;

    this.isSavingProfile.set(true);
    try {
      const res = await fetch(`${this.apiUrl}/profile`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ aboutMe }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      this.aboutMe.set(data?.aboutMe ?? aboutMe.trim());
      return true;
    } catch (e) {
      console.warn('[ChatService] Could not save profile:', e);
      return false;
    } finally {
      this.isSavingProfile.set(false);
    }
  }

  /**
   * Fetches the currently effective (admin-editable, see
   * apps/chat-api/src/services/system-limits.service.ts) attachment limits
   * from the public /config endpoint, so client-side pre-validation in
   * attachMedia() below always matches what the server will actually
   * enforce instead of hardcoding a second, driftable copy. Silently keeps
   * the built-in defaults on failure - this is a UX nicety (a tighter
   * client-side error message before an upload even starts), not the real
   * enforcement boundary, which stays server-side regardless.
   */
  private async loadEffectiveLimits(): Promise<void> {
    try {
      const res = await fetch(`${this.apiUrl}/config`);
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.attachmentMaxCount === 'number') this.maxAttachments.set(data.attachmentMaxCount);
      if (typeof data.attachmentMaxBytes === 'number') this.maxAttachmentBytes.set(data.attachmentMaxBytes);
    } catch (e) {
      console.warn('[ChatService] Could not fetch effective upload limits, using defaults:', e);
    }
  }

  private clearUnauthenticatedHistory() {
    this.unauthUserMessageCount.set(0);
    this.createInitialThread();
    this.aboutMe.set('');
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
          // A reload whose URL names a thread that's actually in this
          // user's history (/chat/:id) resumes that exact thread instead of
          // always landing on a fresh blank one - consumed once so it can't
          // affect a later in-session reload of loadUserThreadHistory.
          const routeThreadId = this.pendingRouteThreadId;
          this.pendingRouteThreadId = null;
          const resumedThread = routeThreadId ? loadedThreads.find((t) => t.id === routeThreadId) : undefined;
          if (resumedThread) {
            this.threads.set(loadedThreads);
            this.activeThreadId.set(resumedThread.id);
            return;
          }

          // No URL, or the URL's thread id is "stuck" (not found in this
          // user's history, e.g. a stale link or another account's chat) -
          // fall back to a fresh new chat, same as before. History is still
          // there in the sidebar to pick up. Not persisted until the user
          // actually sends a message, so an idle page load doesn't clutter
          // saved history with empties.
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

  /** Human-readable name for a model id, falling back to the raw id if it's
   *  not in the currently loaded list (e.g. right after a modelSwitch, before
   *  loadAvailableModels() has refreshed). */
  public modelDisplayName(id: string): string {
    return this.availableModels().find((m) => m.id === id)?.name || id;
  }

  public formatResetLabel(resetAt: number): string {
    const diffMs = resetAt - Date.now();
    if (diffMs <= 0) return 'resets now';
    const hours = Math.round(diffMs / (60 * 60 * 1000));
    return hours < 1 ? `resets in ${Math.max(1, Math.round(diffMs / 60000))}m` : `resets in ${hours}h`;
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
   * Uploads up to maxAttachments() photos/videos and stages them for the
   * next sendMessage() call (composer chips, cleared once sent - see
   * sendMessage below). Images are later sent to the model as vision input;
   * videos are stored and shown in the chat only (see graph.ts
   * toMessageContent()).
   */
  async attachMedia(files: File[]): Promise<void> {
    if (!this.authService.userSignal()) {
      this.attachmentUploadError.set('Sign in to attach photos or videos.');
      return;
    }
    if (files.length === 0) return;

    const limit = this.maxAttachments();
    const room = limit - this.stagedAttachments().length;
    if (room <= 0) {
      this.attachmentUploadError.set(`You can attach up to ${limit} files per message.`);
      return;
    }

    const toUpload = files.slice(0, room);
    this.attachmentUploadError.set(
      files.length > toUpload.length ? `Only attaching the first ${toUpload.length} — max ${limit} files per message.` : null
    );

    const maxBytes = this.maxAttachmentBytes();
    for (const file of toUpload) {
      const isImage = this.ALLOWED_IMAGE_TYPES.includes(file.type);
      const isVideo = this.ALLOWED_VIDEO_TYPES.includes(file.type);
      if (!isImage && !isVideo) {
        this.attachmentUploadError.set(
          `Unsupported file type "${file.type || file.name}". Supported: photos (jpg, png, webp, gif, heic) and video (mp4, mov, webm).`
        );
        return;
      }
      if (file.size > maxBytes) {
        this.attachmentUploadError.set(`"${file.name}" is too large — attachments must be ${Math.round(maxBytes / (1024 * 1024))}MB or smaller.`);
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
      this.activityStatus.set(null);
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
   * True when `msg` is the LAST user message in the active thread - not
   * necessarily the last message overall, since that user turn's assistant
   * reply (or placeholder) normally follows it. Edit is only ever offered
   * here (see chat-window.component.html), mirroring why Regenerate is only
   * offered on the last assistant message: summarizedThroughIndex assumes
   * stable message-array indices, and editing an earlier turn would shift/
   * invalidate it (see PROJECT_CONTEXT.md's Known gaps).
   */
  public isLastUserMessage(msg: ChatMessage): boolean {
    if (msg.role !== 'user') return false;
    const messages = this.activeThread()?.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].id === msg.id;
    }
    return false;
  }

  /** Enters edit mode for `msg` - see isLastUserMessage() for the restriction. */
  public startEditingMessage(msg: ChatMessage): void {
    if (this.isStreaming() || !this.isLastUserMessage(msg)) return;
    this.editingMessageId.set(msg.id);
  }

  /** Leaves edit mode without sending anything. */
  public cancelEditingMessage(): void {
    this.editingMessageId.set(null);
  }

  /**
   * Replaces the LAST user message's content in place and re-runs its
   * assistant reply, exactly like regenerateLastResponse() above (reset the
   * trailing assistant message in place, resend the trailing context) except
   * the edited turn's own content changes too. Because sendMessage() (and
   * this method, on a prior edit) always append a user message and its
   * assistant placeholder together, the last user message - the only one
   * Edit ever targets, see isLastUserMessage() - is always immediately
   * followed by that turn's assistant reply as the very last message in the
   * thread, the same shape regenerateLastResponse() relies on.
   */
  public async editLastUserMessage(newContent: string): Promise<void> {
    const currentThreadId = this.activeThreadId();
    const trimmed = newContent.trim();
    if (!currentThreadId || !trimmed || this.isStreaming()) return;

    const thread = this.activeThread();
    const userMessageId = this.editingMessageId();
    if (!thread || !userMessageId || thread.messages.length < 2) return;

    const lastMessage = thread.messages[thread.messages.length - 1];
    const secondLastMessage = thread.messages[thread.messages.length - 2];
    if (lastMessage.role !== 'assistant' || secondLastMessage.role !== 'user' || secondLastMessage.id !== userMessageId) {
      // Shape doesn't match what editLastUserMessage() expects (e.g. the
      // thread changed out from under an open edit) - the thread-change
      // effect above already clears editingMessageId in that case, but bail
      // out defensively rather than mutate the wrong message.
      return;
    }

    const assistantMessageId = lastMessage.id;

    this.threads.update((threadsList) =>
      threadsList.map((t) =>
        t.id === currentThreadId
          ? {
              ...t,
              updatedAt: Date.now(),
              messages: t.messages.map((m) => {
                if (m.id === userMessageId) return { ...m, content: trimmed };
                if (m.id === assistantMessageId) {
                  // Reset the trailing assistant reply in place, keeping its
                  // id/position, and drop everything the previous run
                  // attached (image, UI cards, suggestions) so stale extras
                  // from the old answer don't linger - same as
                  // regenerateLastResponse() above.
                  return {
                    ...m,
                    content: '',
                    error: false,
                    imageUrl: undefined,
                    ui: undefined,
                    sources: undefined,
                    actions: undefined,
                    suggestions: undefined,
                  };
                }
                return m;
              }),
            }
          : t
      )
    );

    this.editingMessageId.set(null);

    const contextMessages = thread.messages
      .filter((m) => m.id !== assistantMessageId)
      .map((m) => ({
        role: m.role,
        content: m.id === userMessageId ? trimmed : m.content,
        attachments: m.attachments,
      }));

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
    // Each turn researches independently - carrying the previous turn's
    // trace forward would attribute its queries to this answer.
    this.activeResearchTrace.set(null);
    this.activityStatus.set(null);
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

              if (data.research) {
                this.applyResearchEvent(data.research as ResearchStreamEvent);
              }

              if (data.chunk) {
                // Real content supersedes the live status line - once the
                // model is writing, "searching" is stale. The trace itself
                // stays, so the panel can still be expanded.
                this.activityStatus.set(null);
                accumulatedContent += data.chunk;
              }

              this.updateAssistantMessage(threadId, assistantMessageId, accumulatedContent);

              if (data.imageUrl) {
                this.setMessageImageUrl(threadId, assistantMessageId, data.imageUrl);
              }

              if (data.done && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
                this.setMessageSuggestions(threadId, assistantMessageId, data.suggestions);
              }

              // Sources/actions are NOT conditional on `ui`: a researched
              // answer is usually plain prose with no card attached, and
              // gating on `ui` here silently threw away every citation the
              // research node gathered.
              if (data.done && ((Array.isArray(data.ui) && data.ui.length > 0) || data.sources?.length || data.actions?.length)) {
                this.setMessageUi(threadId, assistantMessageId, data.ui ?? [], data.sources, data.actions);
              }

              if (data.done && data.modelSwitch) {
                const { fromModel, toModel, resetAt } = data.modelSwitch;
                const notice = `> ℹ️ **${this.modelDisplayName(fromModel)}**'s daily limit was reached, so this reply used **${this.modelDisplayName(toModel)}** instead (${this.formatResetLabel(resetAt)}).\n\n`;
                accumulatedContent = notice + accumulatedContent;
                this.updateAssistantMessage(threadId, assistantMessageId, accumulatedContent);
                this.setMessageModel(threadId, assistantMessageId, toModel);
                // Switch the active selection too, so the next message
                // doesn't immediately hit the same wall again - the
                // exhausted model stays visible in the dropdown, just
                // greyed out (see loadAvailableModels() below), until it
                // resets or an admin raises the cap.
                this.selectedModel.set(toModel);
                void this.loadAvailableModels();
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
      this.activityStatus.set(null);
      // Pin the trace onto the message before clearing the live one, so the
      // panel stays expandable after the turn (including on reload, since
      // the thread is persisted below).
      const trace = this.activeResearchTrace();
      if (trace) {
        this.setMessageResearch(threadId, assistantMessageId, trace);
        this.activeResearchTrace.set(null);
      }
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
   * Shares plain text via the device's native share sheet (navigator.share -
   * Messages, Email, etc. on mobile). Falls back to copying to the clipboard
   * on browsers that don't support it (most desktop browsers), returning
   * 'copied' so the caller can show its own confirmation - there's no
   * share-sheet equivalent to confirm with there. Shared by
   * shareActiveThread() (whole conversation) and shareMessage() (a single
   * response) below.
   */
  private async shareText(title: string, text: string): Promise<'shared' | 'copied' | 'cancelled' | 'unavailable'> {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text });
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

  /** Shares the active conversation - see shareText() above for the share/clipboard behavior. */
  public async shareActiveThread(): Promise<'shared' | 'copied' | 'cancelled' | 'unavailable'> {
    const thread = this.activeThread();
    if (!thread || !thread.messages.some((m) => m.role === 'user')) return 'unavailable';
    return this.shareText(thread.title, this.formatThreadForSharing(thread));
  }

  /** Shares a single assistant response - see shareText() above for the share/clipboard behavior. */
  public async shareMessage(content: string): Promise<'shared' | 'copied' | 'cancelled' | 'unavailable'> {
    if (!content || !content.trim()) return 'unavailable';
    return this.shareText('NexusAI', content.trim());
  }

  public stopStreaming() {
    if (this.abortController) {
      this.abortController.abort();
      this.isStreaming.set(false);
      this.activityStatus.set(null);
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
   * Folds one research event into the live trace.
   *
   * The backend reports progress as discrete events rather than a rendered
   * string so the panel can show structure - which query is running, which
   * finished, what the planner's reasoning was - instead of a single line
   * that overwrites itself.
   */
  private applyResearchEvent(event: ResearchStreamEvent): void {
    const current: ResearchTrace = this.activeResearchTrace() ?? {
      phase: 'thinking',
      queries: [],
      sources: [],
      browsed: [],
      ran: false,
    };

    switch (event.type) {
      case 'research_status':
        this.activityStatus.set(event.message ?? null);
        this.activeResearchTrace.set({
          ...current,
          phase: event.phase,
          message: event.message,
          // 'skipped' is a real outcome worth showing (it says why the app
          // did not search), but it never counts as research having run.
          ran: event.phase === 'skipped' ? false : current.ran,
        });
        break;

      case 'research_plan':
        this.activeResearchTrace.set({
          ...current,
          reasoning: event.reasoning || current.reasoning,
          queries: event.searchQueries.map((query) => ({ query, status: 'pending' as const })),
          ran: event.needsResearch,
        });
        break;

      case 'research_query_start':
        this.activeResearchTrace.set({
          ...current,
          queries: current.queries.map((q, i) => (i === event.index ? { ...q, status: 'running' } : q)),
        });
        break;

      case 'research_query_done':
        this.activeResearchTrace.set({
          ...current,
          queries: current.queries.map((q, i) =>
            i === event.index
              ? { ...q, status: event.ok ? 'ok' : 'failed', preview: event.preview, citationCount: event.citationCount }
              : q
          ),
        });
        break;

      case 'research_sources':
        this.activeResearchTrace.set({ ...current, sources: event.sources, ran: true });
        break;

      case 'research_browse_start':
        this.activeResearchTrace.set({
          ...current,
          phase: 'browsing',
          browsed: [...current.browsed, { url: event.url, ok: false }],
        });
        break;

      case 'research_browse_done':
        this.activeResearchTrace.set({
          ...current,
          browsed: current.browsed.map((b) =>
            b.url === event.url ? { url: event.url, title: event.title, ok: event.ok } : b
          ),
        });
        break;
    }
  }

  /** Pins the finished trace onto the message, so it survives the turn. */
  private setMessageResearch(threadId: string, messageId: string, trace: ResearchTrace): void {
    this.threads.update((threads) =>
      threads.map((t) => {
        if (t.id !== threadId) return t;
        return { ...t, messages: t.messages.map((m) => (m.id === messageId ? { ...m, research: trace } : m)) };
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

  private setMessageModel(threadId: string, messageId: string, model: AIModelType) {
    this.threads.update((threadsList) =>
      threadsList.map((t) => {
        if (t.id === threadId) {
          const updatedMessages = t.messages.map((m) => (m.id === messageId ? { ...m, model } : m));
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
