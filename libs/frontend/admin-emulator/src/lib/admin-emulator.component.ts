import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ADMIN_API_BASE_URL, ADMIN_AUTH_BRIDGE } from '@chat-monorepo/admin-analytics';

export interface StageState {
  id: string;
  name: string;
  description: string;
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
    <div class="p-6 text-slate-100 min-h-screen bg-slate-950/90 font-sans">
      <!-- Header -->
      <div class="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center border-b border-white/10 pb-4">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-white flex items-center gap-3">
            <span>⚡ Subsystem Orchestration Emulator</span>
            <span class="text-xs px-2.5 py-1 rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">ADMIN ONLY</span>
          </h1>
          <p class="text-sm text-slate-400 mt-1">
            Real-time step-by-step state transition visualizer across Orchestration, Embedding, RAG, Memory, Context, Tools & LLM response.
          </p>
        </div>
      </div>

      <!-- Test Input Bar -->
      <div class="mb-8 p-4 rounded-xl backdrop-blur-md bg-white/5 border border-white/10">
        <label class="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Emulation Query Test Bench</label>
        <div class="flex gap-3">
          <input
            type="text"
            [(ngModel)]="queryText"
            placeholder="Type any test query (e.g. 'Explain RAG search or calculate 45 * 12')"
            class="flex-1 bg-slate-900 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-cyan-500 transition"
            [disabled]="isRunning()"
          />
          <button
            (click)="runEmulation()"
            [disabled]="isRunning() || !queryText.trim()"
            class="px-6 py-2.5 rounded-lg font-semibold text-sm bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-white shadow-lg transition flex items-center gap-2"
          >
            <span *ngIf="isRunning()" class="inline-block animate-spin">⏳</span>
            <span>{{ isRunning() ? 'Running Pipeline...' : 'Simulate Pipeline' }}</span>
          </button>
        </div>
      </div>

      <!-- Animated Stage Timeline Nodes -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div
          *ngFor="let stage of stages(); let i = index"
          (click)="selectedStage.set(stage)"
          [ngClass]="{
            'border-cyan-500 bg-cyan-950/20 ring-1 ring-cyan-500/50 scale-[1.02] shadow-cyanGlow': selectedStage()?.id === stage.id,
            'border-emerald-500/50 bg-emerald-950/20 shadow-emerald-500/10': stage.status === 'completed',
            'border-amber-400 bg-amber-500/20 animate-pulse ring-2 ring-amber-400/50 scale-105 z-10 shadow-lg shadow-amber-500/20': stage.status === 'running',
            'border-slate-700 bg-white/5 opacity-60': stage.status === 'idle' || stage.status === 'skipped'
          }"
          class="p-4 rounded-xl border backdrop-blur-md cursor-pointer transition-all duration-300 hover:border-cyan-400/80 relative overflow-hidden group"
        >
          <!-- Active Stage Progress Bar Indicator -->
          <div
            *ngIf="stage.status === 'running'"
            class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 animate-pulse"
          ></div>
          <div
            *ngIf="stage.status === 'completed'"
            class="absolute top-0 left-0 right-0 h-1 bg-emerald-400"
          ></div>

          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-bold text-slate-400 uppercase tracking-wide">Node #0{{ i + 1 }}</span>
            <span
              [ngClass]="{
                'bg-emerald-500/20 text-emerald-400 border-emerald-500/30': stage.status === 'completed',
                'bg-amber-500/20 text-amber-300 border-amber-400 animate-bounce': stage.status === 'running',
                'bg-slate-700/40 text-slate-400 border-slate-600': stage.status === 'idle' || stage.status === 'skipped'
              }"
              class="text-[10px] px-2.5 py-0.5 rounded-full border uppercase font-medium transition-all"
            >
              {{ stage.status === 'running' ? '⚡ RUNNING' : stage.status }}
            </span>
          </div>
          <h3 class="text-base font-semibold text-white mb-1 group-hover:text-cyan-300 transition-colors">{{ stage.name }}</h3>
          <p class="text-xs text-slate-400 line-clamp-1">{{ stage.description }}</p>
          <div class="mt-3 text-[11px] text-slate-400 flex justify-between items-center">
            <span>Latency</span>
            <span class="font-mono text-cyan-300 font-bold">{{ stage.durationMs }}ms</span>
          </div>
        </div>
      </div>

      <!-- Visual Pipeline Data Flow Diagram -->
      <div class="mb-8 p-6 rounded-xl backdrop-blur-md bg-white/5 border border-white/10">
        <h3 class="text-sm font-bold uppercase tracking-wider text-slate-300 mb-4 flex items-center gap-2">
          <span>🔄 Subsystem Data Flow & Connector Pipeline</span>
          <span *ngIf="isRunning()" class="text-xs text-cyan-400 animate-pulse font-normal">● Live Data Packets Flowing</span>
        </h3>
        <div class="flex items-center justify-between overflow-x-auto py-4 px-2 gap-2 border border-white/5 rounded-lg bg-slate-900/60">
          <ng-container *for="let stage of stages(); let i = index">
            <div
              (click)="selectedStage.set(stage)"
              [ngClass]="{
                'bg-amber-500/30 text-amber-300 border-amber-400 ring-2 ring-amber-400/50 scale-105': stage.status === 'running',
                'bg-emerald-500/20 text-emerald-400 border-emerald-500/40': stage.status === 'completed',
                'bg-slate-800 text-slate-400 border-slate-700': stage.status === 'idle' || stage.status === 'skipped'
              }"
              class="px-3 py-2 rounded-lg border text-xs font-semibold whitespace-nowrap cursor-pointer transition-all duration-300 flex items-center gap-1.5 shadow-md"
            >
              <span class="w-2 h-2 rounded-full" [ngClass]="stage.status === 'running' ? 'bg-amber-400 animate-ping' : stage.status === 'completed' ? 'bg-emerald-400' : 'bg-slate-600'"></span>
              <span>{{ stage.name }}</span>
            </div>
            <div *ngIf="i < stages().length - 1" class="text-slate-600 font-mono text-sm px-1 flex items-center">
              <span [ngClass]="stages()[i].status === 'completed' ? 'text-cyan-400 animate-pulse' : 'text-slate-700'">➔</span>
            </div>
          </ng-container>
        </div>
      </div>

      <!-- Detail Payload Inspector -->
      <div *ngIf="selectedStage()" class="p-6 rounded-xl backdrop-blur-md bg-white/5 border border-white/10">
        <div class="flex items-center justify-between mb-4 border-b border-white/10 pb-3">
          <div>
            <h2 class="text-lg font-bold text-white">{{ selectedStage()?.name }} Stage Inspection</h2>
            <p class="text-xs text-slate-400">Inspecting Node Execution Payload & State Data</p>
          </div>
          <span class="text-xs font-mono text-cyan-400 bg-cyan-950/40 px-3 py-1 rounded-full border border-cyan-800">
            ID: {{ selectedStage()?.id }}
          </span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Input Payload</h4>
            <pre class="p-4 rounded-lg bg-slate-900 border border-white/10 text-xs font-mono text-emerald-400 overflow-x-auto max-h-60">{{ selectedStage()?.inputPayload | json }}</pre>
          </div>
          <div>
            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Output Payload / Telemetry</h4>
            <pre class="p-4 rounded-lg bg-slate-900 border border-white/10 text-xs font-mono text-cyan-400 overflow-x-auto max-h-60">{{ selectedStage()?.outputPayload | json }}</pre>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class AdminEmulatorComponent {
  private readonly auth = inject(ADMIN_AUTH_BRIDGE, { optional: true });
  private readonly baseUrl = inject(ADMIN_API_BASE_URL, { optional: true });

  queryText = 'Explain RAG search and memory optimization';
  isRunning = signal<boolean>(false);

  stages = signal<StageState[]>([
    { id: 'orchestration', name: 'Orchestration Router', description: 'LangGraph node state evaluation', status: 'idle', durationMs: 0, inputPayload: null, outputPayload: null },
    { id: 'embedding', name: 'Vector Embedding', description: 'Query vector generation', status: 'idle', durationMs: 0, inputPayload: null, outputPayload: null },
    { id: 'rag', name: 'RAG Hybrid Reranker', description: 'Dense similarity & BM25 retrieval', status: 'idle', durationMs: 0, inputPayload: null, outputPayload: null },
    { id: 'memory', name: 'Long-term Memory', description: 'Regex gate check & memory sync', status: 'idle', durationMs: 0, inputPayload: null, outputPayload: null },
    { id: 'context', name: 'Context Builder', description: 'System prompt template assembly', status: 'idle', durationMs: 0, inputPayload: null, outputPayload: null },
    { id: 'web_search', name: 'Web Search Tool', description: 'Google search API fallback', status: 'idle', durationMs: 0, inputPayload: null, outputPayload: null },
    { id: 'mcp', name: 'MCP Sandbox Tool', description: 'Isolated VM code execution', status: 'idle', durationMs: 0, inputPayload: null, outputPayload: null },
    { id: 'llm_response', name: 'LLM Token Stream', description: 'SSE response token streaming', status: 'idle', durationMs: 0, inputPayload: null, outputPayload: null },
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
