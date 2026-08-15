import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatService } from '../../services/chat.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <aside
      [class.translate-x-0]="isOpen"
      [class.-translate-x-full]="!isOpen"
      class="w-72 glass-card border-r border-glassBorder flex flex-col transition-transform duration-300 ease-in-out absolute md:relative z-20 h-[calc(100vh-4rem)] backdrop-blur-xl bg-obsidian/70"
    >
      <!-- New Chat Action Button -->
      <div class="p-4 border-b border-glassBorder">
        <button
          (click)="chatService.createNewThread()"
          class="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-white/10 to-white/5 hover:from-white/15 hover:to-white/10 border border-white/10 flex items-center justify-center space-x-2 text-sm font-medium transition-all shadow-glass hover:shadow-glow"
        >
          <svg class="w-5 h-5 text-accentCyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          <span>New Thread</span>
        </button>
      </div>

      <!-- Threads History List -->
      <div class="flex-1 overflow-y-auto p-3 space-y-2">
        <div class="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Chat History
        </div>

        <div *ngFor="let thread of chatService.threads()">
          <button
            (click)="chatService.selectThread(thread.id)"
            [ngClass]="chatService.activeThreadId() === thread.id ? 'bg-white/10 border-white/20' : ''"
            class="w-full text-left p-3 rounded-xl border border-transparent hover:border-glassBorder hover:bg-white/5 transition-all group flex items-start space-x-3"
          >
            <div class="p-2 rounded-lg bg-obsidian/60 text-slate-400 group-hover:text-accentCyan transition-colors">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <div class="flex-1 overflow-hidden">
              <div class="text-xs font-medium text-slate-200 truncate">{{ thread.title }}</div>
              <div class="text-[10px] text-slate-400 mt-1 flex items-center justify-between">
                <span>{{ thread.model }}</span>
                <span>{{ thread.updatedAt | date:'shortTime' }}</span>
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- Footer Adapter Status Stubs -->
      <div class="p-4 border-t border-glassBorder bg-obsidian/50 text-xs space-y-2">
        <div class="flex items-center justify-between text-slate-400">
          <span>MCP Adapter</span>
          <span class="text-accentEmerald flex items-center space-x-1">
            <span class="w-1.5 h-1.5 rounded-full bg-accentEmerald"></span>
            <span>Ready</span>
          </span>
        </div>
        <div class="flex items-center justify-between text-slate-400">
          <span>RAG / Vector DB</span>
          <span class="text-accentCyan flex items-center space-x-1">
            <span class="w-1.5 h-1.5 rounded-full bg-accentCyan"></span>
            <span>Active</span>
          </span>
        </div>
      </div>
    </aside>
  `,
})
export class SidebarComponent {
  @Input() isOpen = true;

  constructor(public chatService: ChatService) {}
}
