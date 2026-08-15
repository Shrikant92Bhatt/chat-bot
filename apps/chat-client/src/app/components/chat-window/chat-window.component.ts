import { Component, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatService } from '../../services/chat.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-chat-window',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="flex-1 flex flex-col h-full overflow-hidden relative">
      <!-- Distinctive Ambient Backdrops -->
      <div class="ambient-glow-emerald"></div>
      <div class="ambient-glow-indigo"></div>
      <div class="ambient-glow-magenta"></div>

      <!-- Messages Stream Feed -->
      <div #scrollContainer class="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 relative z-10">
        <!-- Empty State Hero -->
        <div *ngIf="chatService.activeMessages().length === 0" class="h-full flex flex-col items-center justify-center text-center p-6 max-w-lg mx-auto">
          <div class="w-16 h-16 rounded-3xl bg-gradient-to-tr from-brandEmerald via-brandMint to-brandIndigo p-0.5 shadow-emeraldGlow mb-6 animate-pulse">
            <div class="w-full h-full bg-abyss rounded-[22px] flex items-center justify-center">
              <svg class="w-8 h-8 text-brandMint" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L5.6 15.11a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
            </div>
          </div>
          <h2 class="text-2xl font-bold bg-gradient-to-r from-white via-emerald-200 to-indigo-200 bg-clip-text text-transparent mb-2">
            NexusAI Intelligence Gateway
          </h2>
          <p class="text-sm text-slate-400 mb-6">
            Multi-LLM SSE streaming router active. Switch models seamlessly between Google Gemini and OpenAI GPT-4o.
          </p>

          <!-- Prompt Cards -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
            <button
              (click)="chatService.sendMessage('Architect an Nx monorepo pipeline for GCP Cloud Run.')"
              class="p-4 glass-card glass-card-hover rounded-2xl text-left border border-glassBorder group"
            >
              <div class="text-xs font-semibold text-brandMint group-hover:underline">GCP Architecture</div>
              <div class="text-xs text-slate-300 mt-1">Design an automated Nx Monorepo CI/CD deployment.</div>
            </button>

            <button
              (click)="chatService.sendMessage('Explain Model Context Protocol (MCP) adapter integration.')"
              class="p-4 glass-card glass-card-hover rounded-2xl text-left border border-glassBorder group"
            >
              <div class="text-xs font-semibold text-brandIndigo group-hover:underline">MCP Protocol</div>
              <div class="text-xs text-slate-300 mt-1">Learn how MCP tool execution works in Express.</div>
            </button>
          </div>
        </div>

        <!-- Chat Messages -->
        <div *ngFor="let msg of chatService.activeMessages()" class="space-y-2">
          <!-- User Message -->
          <div *ngIf="msg.role === 'user'" class="flex justify-end items-start space-x-3">
            <div class="max-w-2xl px-5 py-3.5 rounded-3xl bg-gradient-to-r from-brandEmerald/25 via-teal-900/30 to-brandIndigo/25 border border-brandEmerald/30 backdrop-blur-md shadow-glass text-slate-100 text-sm leading-relaxed">
              {{ msg.content }}
            </div>
            <div class="w-8 h-8 rounded-xl bg-brandEmerald/20 border border-brandEmerald/40 flex items-center justify-center text-xs font-semibold text-brandMint shadow-sm shrink-0">
              U
            </div>
          </div>

          <!-- Assistant Message -->
          <div *ngIf="msg.role === 'assistant'" class="flex justify-start items-start space-x-3">
            <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-brandEmerald via-brandMint to-brandIndigo flex items-center justify-center text-abyss shadow-emeraldGlow shrink-0">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>

            <div class="max-w-3xl glass-card rounded-3xl p-5 border border-glassBorder shadow-glass text-slate-200 text-sm leading-relaxed space-y-2">
              <div class="flex items-center justify-between text-[11px] text-slate-400 mb-2 border-b border-white/5 pb-2">
                <span class="font-medium text-brandMint">NexusAI ({{ msg.model || 'Gemini' }})</span>
                <span>{{ msg.timestamp | date:'mediumTime' }}</span>
              </div>

              <div class="whitespace-pre-wrap font-sans">{{ msg.content }}</div>

              <!-- Streaming Pulse Indicator -->
              <div *ngIf="chatService.isStreaming() && !msg.content" class="flex items-center space-x-2 py-2">
                <span class="w-2 h-2 rounded-full bg-brandMint animate-ping"></span>
                <span class="text-xs text-slate-400">Synthesizing stream...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class ChatWindowComponent implements AfterViewChecked {
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;

  constructor(
    public chatService: ChatService,
    public authService: AuthService
  ) {}

  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    try {
      this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
    } catch (err) {}
  }
}
