import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { ChatService } from '../../services/chat.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="h-16 px-6 glass-card border-b border-glassBorder flex items-center justify-between z-30 backdrop-blur-md">
      <!-- Left: Brand & Sidebar Toggle -->
      <div class="flex items-center space-x-4">
        <!-- Sidebar Toggle Button (Only visible when user is logged in) -->
        <button
          *ngIf="authService.userSignal()"
          (click)="toggleSidebar.emit()"
          class="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-all duration-200"
          aria-label="Toggle Sidebar"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div class="flex items-center space-x-3">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-accentCyan to-accentViolet flex items-center justify-center shadow-[0_4px_14px_rgba(6,182,212,0.35)] border-t border-white/20 border-b border-black/30">
            <svg class="w-5 h-5 text-white drop-shadow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <span class="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent">
            Nexus<span class="bg-gradient-to-r from-accentCyan to-accentViolet bg-clip-text text-transparent">AI</span>
          </span>
        </div>
      </div>

      <!-- Center: Multi-LLM Routing Selector -->
      <div class="flex items-center space-x-2 bg-slateBg/90 p-1.5 rounded-2xl border border-glassBorder shadow-inner">
        <button
          (click)="chatService.setModel('gemini-1.5-flash')"
          [ngClass]="{
            'bg-accentCyan/20 text-cyan-300 border border-accentCyan/40 shadow-cyanGlow': chatService.selectedModel().startsWith('gemini')
          }"
          class="px-4 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 flex items-center space-x-2 hover:text-white"
        >
          <span class="w-2 h-2 rounded-full bg-accentCyan animate-pulse"></span>
          <span>Google Gemini</span>
        </button>

        <button
          (click)="chatService.setModel('gpt-4o')"
          [ngClass]="{
            'bg-accentViolet/20 text-violet-300 border border-accentViolet/40 shadow-glow': chatService.selectedModel().startsWith('gpt')
          }"
          class="px-4 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 flex items-center space-x-2 hover:text-white"
        >
          <span class="w-2 h-2 rounded-full bg-accentViolet animate-pulse"></span>
          <span>OpenAI GPT-4o</span>
        </button>
      </div>

      <!-- Right: User Auth Profile -->
      <div class="flex items-center space-x-4">
        <!-- MCP Toggle Pill -->
        <button
          (click)="chatService.toggleMcp()"
          [ngClass]="{ 'bg-accentViolet/20 border-accentViolet/50 text-violet-300': chatService.mcpEnabled() }"
          class="hidden sm:flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs font-medium border border-glassBorder hover:border-accentCyan/40 transition-all"
        >
          <span class="text-slate-400">MCP Protocol</span>
          <span class="w-2 h-2 rounded-full" [class.bg-accentCyan]="chatService.mcpEnabled()" [class.bg-slate-600]="!chatService.mcpEnabled()"></span>
        </button>

        <ng-container *ngIf="authService.userSignal() as user; else loginBtn">
          <div class="flex items-center space-x-3 bg-white/5 px-3 py-1.5 rounded-2xl border border-glassBorder">
            <img [src]="user.photoURL" [alt]="user.displayName" class="w-7 h-7 rounded-full border border-accentCyan" />
            <span class="text-xs font-medium text-slate-200 hidden md:inline">{{ user.displayName }}</span>
            <button
              (click)="authService.logout()"
              class="text-xs text-slate-400 hover:text-rose-400 transition-colors ml-2"
              title="Sign Out"
            >
              Sign Out
            </button>
          </div>
        </ng-container>

        <ng-template #loginBtn>
          <button
            (click)="authService.loginWithGoogle()"
            class="px-5 py-2.5 rounded-2xl bg-gradient-to-r from-accentCyan to-accentViolet text-white font-bold shadow-[0_6px_20px_rgba(139,92,246,0.35)] border-t border-white/25 border-b border-black/30 hover:shadow-[0_8px_25px_rgba(6,182,212,0.45)] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-inner transition-all duration-200 flex items-center justify-center space-x-2.5 cursor-pointer backdrop-blur-sm"
          >
            <svg class="w-4 h-4 drop-shadow" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.545,6.477,2.545,12s4.476,10,10,10c5.768,0,9.757-4.056,9.757-9.927c0-0.669-0.071-1.317-0.187-1.834H12.545z"/>
            </svg>
            <span class="drop-shadow-sm">Google Sign In</span>
          </button>
        </ng-template>
      </div>
    </header>
  `,
})
export class NavbarComponent {
  @Output() toggleSidebar = new EventEmitter<void>();

  constructor(
    public authService: AuthService,
    public chatService: ChatService
  ) {}
}
