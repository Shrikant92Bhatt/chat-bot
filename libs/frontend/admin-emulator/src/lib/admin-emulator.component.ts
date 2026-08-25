import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ADMIN_API_BASE_URL, ADMIN_AUTH_BRIDGE } from '@chat-monorepo/admin-analytics';

export interface StageState {
  id: string;
  name: string;
  subsystem: string;
  description: string;
  explanation: string;
  dataFlowText: string;
  status: 'idle' | 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  durationMs: number;
  inputPayload: any;
  outputPayload: any;
}

@Component({
  selector: 'app-admin-emulator',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="p-6 text-slate-100 min-h-screen bg-slate-950/95 font-sans">
      <!-- Header -->
      <div class="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center border-b border-white/10 pb-4">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
            <span>⚡ System Architecture & Execution Flow Emulator</span>
            <span class="text-xs px-2.5 py-1 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 font-mono">ADMIN TELEMETRY</span>
          </h1>
          <p class="text-sm text-slate-400 mt-1">
            Visualizing step-by-step data transformations and subsystem transitions across the AI Chat monorepo.
          </p>
        </div>
      </div>

      <!-- Test Input Bench -->
      <div class="mb-8 p-5 rounded-2xl backdrop-blur-xl bg-slate-900/80 border border-white/10 shadow-2xl">
        <label class="block text-xs font-bold uppercase tracking-wider text-cyan-400 mb-2 flex items-center gap-2">
          <span>🧪 Interactive Pipeline Simulator</span>
          <span class="text-[10px] text-slate-400 font-normal lowercase">(Simulates live graph execution)</span>
        </label>
        <div class="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            [(ngModel)]="queryText"
            placeholder="Type any test query (e.g. 'Calculate 15 * 8 and search quantum computing news')"
            class="flex-1 bg-slate-950 border border-white/15 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition font-mono"
            [disabled]="isRunning()"
          />
          <button
            (click)="runEmulation()"
            [disabled]="isRunning() || !queryText.trim()"
            class="px-6 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:opacity-50 text-white shadow-lg shadow-cyan-500/20 transition flex items-center justify-center gap-2 cursor-pointer"
          >
            <span *ngIf="isRunning()" class="inline-block animate-spin text-base">⚙️</span>
            <span>{{ isRunning() ? 'Executing Graph Nodes...' : '🚀 Run System Emulation' }}</span>
          </button>
        </div>
      </div>

      <!-- All-in-One Expanded Subsystem Pipeline (Input & Output Visible Side-by-Side for Every Stage) -->
      <div class="space-y-6">
        <div
          *ngFor="let stage of stages(); let i = index"
          [ngClass]="{
            'border-emerald-500/50 bg-slate-900/90 shadow-emerald-500/10': stage.status === 'completed',
            'border-amber-400 bg-amber-950/20 ring-2 ring-amber-400/50 animate-pulse shadow-xl shadow-amber-500/20': stage.status === 'running',
            'border-slate-800 bg-slate-900/50 opacity-80': stage.status === 'idle' || stage.status === 'skipped'
          }"
          class="p-6 rounded-2xl border backdrop-blur-xl transition-all duration-300 relative shadow-2xl overflow-hidden"
        >
          <!-- Top Accent Line -->
          <div *ngIf="stage.status === 'running'" class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 animate-pulse"></div>
          <div *ngIf="stage.status === 'completed'" class="absolute top-0 left-0 right-0 h-1 bg-emerald-400"></div>

          <!-- Stage Header Bar -->
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 pb-3 border-b border-white/10">
            <div class="flex items-center gap-3">
              <span class="text-xs font-mono font-bold text-cyan-400 bg-cyan-950/80 border border-cyan-800/80 px-2.5 py-1 rounded-lg">STAGE 0{{ i + 1 }}</span>
              <h2 class="text-lg font-bold text-white flex items-center gap-2">
                <span>{{ stage.name }}</span>
                <span class="text-xs font-normal text-slate-400 font-mono">({{ stage.subsystem }})</span>
              </h2>
            </div>

            <div class="flex items-center gap-3">
              <span
                [ngClass]="{
                  'bg-emerald-500/20 text-emerald-400 border-emerald-500/40': stage.status === 'completed',
                  'bg-amber-500/20 text-amber-300 border-amber-400 animate-bounce': stage.status === 'running',
                  'bg-slate-800 text-slate-400 border-slate-700': stage.status === 'idle' || stage.status === 'skipped'
                }"
                class="text-xs font-mono px-3 py-1 rounded-full border uppercase font-bold tracking-wide"
              >
                {{ stage.status === 'running' ? '⚡ EXECUTING' : stage.status }}
              </span>
              <span class="text-xs font-mono text-cyan-300 font-bold bg-slate-950 px-3 py-1 rounded-lg border border-white/10">
                ⏱️ {{ stage.durationMs }}ms
              </span>
            </div>
          </div>

          <!-- Architectural Explanation & Data Flow -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div class="p-3.5 rounded-xl bg-slate-950/80 border border-cyan-500/20">
              <h4 class="text-[11px] font-bold uppercase tracking-wider text-cyan-400 mb-1 flex items-center gap-1.5">
                <span>📘 What Happens Here</span>
              </h4>
              <p class="text-xs text-slate-300 leading-relaxed">{{ stage.explanation }}</p>
            </div>

            <div class="p-3.5 rounded-xl bg-slate-950/80 border border-indigo-500/20">
              <h4 class="text-[11px] font-bold uppercase tracking-wider text-indigo-400 mb-1 flex items-center gap-1.5">
                <span>🔀 Data Flow Contract</span>
              </h4>
              <p class="text-xs text-slate-300 leading-relaxed">{{ stage.dataFlowText }}</p>
            </div>
          </div>

          <!-- INPUT vs OUTPUT Side-by-Side Live Data Telemetry -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- INPUT SECTION -->
            <div class="rounded-xl border border-emerald-500/30 bg-slate-950/90 overflow-hidden shadow-inner">
              <div class="px-4 py-2 bg-emerald-950/60 border-b border-emerald-500/30 flex items-center justify-between">
                <span class="text-xs font-bold font-mono text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>📥 SECTION INPUT (DATA IN)</span>
                </span>
                <span class="text-[10px] font-mono text-emerald-500/70">PAYLOAD JSON</span>
              </div>
              <pre class="p-4 text-xs font-mono text-emerald-300 overflow-x-auto max-h-52 font-mono leading-relaxed">{{ (stage.inputPayload ? (stage.inputPayload | json) : '// Awaiting graph trigger...') }}</pre>
            </div>

            <!-- OUTPUT SECTION -->
            <div class="rounded-xl border border-cyan-500/30 bg-slate-950/90 overflow-hidden shadow-inner">
              <div class="px-4 py-2 bg-cyan-950/60 border-b border-cyan-500/30 flex items-center justify-between">
                <span class="text-xs font-bold font-mono text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                  <span>📤 SECTION OUTPUT (DATA OUT)</span>
                </span>
                <span class="text-[10px] font-mono text-cyan-500/70">TELEMETRY RESULT</span>
              </div>
              <pre class="p-4 text-xs font-mono text-cyan-300 overflow-x-auto max-h-52 font-mono leading-relaxed">{{ (stage.outputPayload ? (stage.outputPayload | json) : '// Awaiting stage completion...') }}</pre>
            </div>
          </div>

          <!-- Directional Arrow Connector to Next Section -->
          <div *ngIf="i < stages().length - 1" class="flex justify-center my-4">
            <div class="w-8 h-8 rounded-full bg-slate-900 border border-white/20 flex items-center justify-center text-slate-400 text-sm shadow-lg">
              <span [ngClass]="stages()[i].status === 'completed' ? 'text-cyan-400 animate-pulse font-bold' : 'text-slate-600'">⬇️</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class AdminEmulatorComponent {
  private readonly auth = inject(ADMIN_AUTH_BRIDGE, { optional: true });
  private readonly baseUrl = inject(ADMIN_API_BASE_URL, { optional: true });

  queryText = 'Calculate 15 * 8 and search quantum computing news';
  isRunning = signal<boolean>(false);

  stages = signal<StageState[]>([
    {
      id: 'orchestration',
      name: 'Orchestration Router',
      subsystem: 'LangGraph State Machine',
      description: 'Evaluates user query & determines parallel execution graph routes.',
      explanation: 'Receives the raw incoming user prompt and evaluates graph state parameters to determine which downstream nodes (Vector DB, Memory Gate, MCP Tools) need to be activated.',
      dataFlowText: 'Input: Raw user text query. Output: LangGraph node execution target array [embedding, rag, memory, context, research, tools].',
      status: 'idle',
      durationMs: 0,
      inputPayload: null,
      outputPayload: null,
    },
    {
      id: 'embedding',
      name: 'Vector Embedding',
      subsystem: 'VectorDbAdapter',
      description: 'Generates 256-dim L2-normalized vector representations of text.',
      explanation: 'Passes text through the VectorDbAdapter bag-of-words hashing algorithm to produce a dense 256-dimensional vector embedding for semantic search.',
      dataFlowText: 'Input: Query string. Output: 256-dimensional numerical vector array used for cosine similarity scoring.',
      status: 'idle',
      durationMs: 0,
      inputPayload: null,
      outputPayload: null,
    },
    {
      id: 'rag',
      name: 'RAG Hybrid Reranker',
      subsystem: 'RagRetriever & RRF',
      description: 'Fuses dense vector similarity & sparse BM25 lexical keyword scores.',
      explanation: 'Queries the multi-tenant Knowledge Base, calculating cosine similarity and BM25 text match scores, then applies Reciprocal Rank Fusion (RRF) to rank top relevant chunks.',
      dataFlowText: 'Input: Query vector + search scope parameters. Output: Array of top-K relevant Knowledge Base document snippets.',
      status: 'idle',
      durationMs: 0,
      inputPayload: null,
      outputPayload: null,
    },
    {
      id: 'memory',
      name: 'Long-term Memory',
      subsystem: 'Memory Gate & Service',
      description: 'Filters first-person facts via regex heuristics & extracts memories.',
      explanation: 'Evaluates input against the looksMemorable regex gate. Rejects temporary questions/greetings; extracts durable user preferences and personal facts into Firestore.',
      dataFlowText: 'Input: User chat history turn. Output: Filtered durable user memory candidates (identity, instruction, preference).',
      status: 'idle',
      durationMs: 0,
      inputPayload: null,
      outputPayload: null,
    },
    {
      id: 'context',
      name: 'Context Builder',
      subsystem: 'Headroom CCR & Templates',
      description: 'Assembles versioned prompt templates & applies Headroom compression.',
      explanation: 'Executes parallel Promise.allSettled context gathering for Projects, Memory, and RAG. Applies Headroom CCR minification to compress context by up to 90%.',
      dataFlowText: 'Input: RAG chunks + extracted memories + model template key. Output: Compressed unified System Prompt string.',
      status: 'idle',
      durationMs: 0,
      inputPayload: null,
      outputPayload: null,
    },
    {
      id: 'research',
      name: 'Research Planner',
      subsystem: 'Planner Node & Parallel Fan-out',
      description: 'Plans targeted search queries, then runs them all at once.',
      explanation:
        'Gated twice so simple turns pay nothing: a recency heuristic runs first, and only if it passes does a cheap planner model decide whether live data is actually needed. When it is, the planner splits the question into up to 4 independent queries (6 in deep research) which are dispatched in parallel via Promise.allSettled, so one dead query degrades the evidence instead of failing the turn.',
      dataFlowText:
        'Input: Latest user turn. Output: Deduplicated findings + citations, injected as the research_findings:v1 block at the end of the system prompt, before the agent writes a word.',
      status: 'idle',
      durationMs: 0,
      inputPayload: null,
      outputPayload: null,
    },
    {
      id: 'web_search',
      name: 'Web Search Tool',
      subsystem: 'Google Search API',
      description: 'Fetches real-time web results for queries requiring external news/data.',
      explanation: 'Dispatched conditionally when query contains web search keywords (latest, news, weather). Fetches live web pages and parses grounded citation links.',
      dataFlowText: 'Input: Web query string. Output: Grounded search result items (titles, snippets, citation URLs).',
      status: 'idle',
      durationMs: 0,
      inputPayload: null,
      outputPayload: null,
    },
    {
      id: 'mcp',
      name: 'MCP Sandbox Tool',
      subsystem: 'isolated-vm Sandbox',
      description: 'Executes sandboxed TypeScript/JavaScript code & calculator math.',
      explanation: 'Dispatched for mathematical expressions or code execution requirements. Runs TypeScript code inside a secure isolated-vm V8 engine with memory timeouts.',
      dataFlowText: 'Input: Mathematical expression or code block. Output: Calculated result value or console execution output payload.',
      status: 'idle',
      durationMs: 0,
      inputPayload: null,
      outputPayload: null,
    },
    {
      id: 'llm_response',
      name: 'LLM Response Stream',
      subsystem: 'OpenRouter / OmniRoute Gateway',
      description: 'Streams response token deltas via Server-Sent Events (SSE).',
      explanation: 'Connects to OpenRouter / OmniRoute LLM gateway, receiving real-time token stream deltas and pushing SSE chunks directly to the chat client UI.',
      dataFlowText: 'Input: Assembled system prompt + turn history. Output: Continuous SSE data: { deltaToken } stream until [DONE].',
      status: 'idle',
      durationMs: 0,
      inputPayload: null,
      outputPayload: null,
    },
  ]);

  selectedStage = signal<StageState | null>(this.stages()[0]);

  runEmulation() {
    this.isRunning.set(true);
    const token = this.auth?.getIdToken() || '';
    const apiHost = this.baseUrl || '';

    // Reset stages
    this.stages.update((st) =>
      st.map((s) => ({ ...s, status: 'idle', durationMs: 0, inputPayload: null, outputPayload: null }))
    );

    fetch(`${apiHost}/api/v1/admin/emulator/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: this.queryText }),
    })
      .then((res) => {
        if (!res.body) throw new Error('ReadableStream not supported');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processText = ({ done, value }: { done: boolean; value?: Uint8Array }) => {
          if (done) {
            this.isRunning.set(false);
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '').trim();
              if (dataStr === '[DONE]') {
                this.isRunning.set(false);
                return;
              }

              try {
                const event = JSON.parse(dataStr);
                this.updateStageEvent(event);
              } catch (e) {
                // Ignore parse errors on telemetry chunks
              }
            }
          }

          reader.read().then(processText);
        };

        reader.read().then(processText);
      })
      .catch((err) => {
        console.error('Emulation stream error:', err);
        this.isRunning.set(false);
      });
  }

  private updateStageEvent(event: any) {
    this.stages.update((currentStages) =>
      currentStages.map((stage) => {
        if (stage.id === event.stageId) {
          const updated: StageState = {
            ...stage,
            status: event.status,
            durationMs: event.durationMs,
            inputPayload: event.inputPayload ?? stage.inputPayload,
            outputPayload: event.outputPayload ?? stage.outputPayload,
          };
          if (this.selectedStage()?.id === stage.id) {
            this.selectedStage.set(updated);
          }
          return updated;
        }
        return stage;
      })
    );
  }
}
