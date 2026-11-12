import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

let nextLogoId = 0;

/**
 * NexusAI brand mark: an "N" drawn as a constellation - four nodes joined by
 * a single stroke, the two inner nodes bridged by the diagonal. It reads as a
 * network (the "nexus") and as the letter at once, and stays legible down to
 * favicon size. Gradient ids are unique per instance so several logos on one
 * page never share (or lose) a <defs> reference.
 */
@Component({
  selector: 'app-nexus-logo',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="inline-flex items-center gap-2.5 select-none">
      <svg
        [attr.width]="size"
        [attr.height]="size"
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
        class="shrink-0"
        [ngClass]="glow ? 'drop-shadow-[0_4px_14px_rgba(124,108,255,0.45)]' : ''"
      >
        <defs>
          <linearGradient [attr.id]="id + 'bg'" x1="8" y1="4" x2="58" y2="62" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#8b7bff" />
            <stop offset="0.55" stop-color="#6d5dfc" />
            <stop offset="1" stop-color="#4338ca" />
          </linearGradient>
          <linearGradient [attr.id]="id + 'fg'" x1="16" y1="48" x2="48" y2="16" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#ffffff" />
            <stop offset="1" stop-color="#c7f9ee" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="18" [attr.fill]="'url(#' + id + 'bg)'" />
        <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="17.25" stroke="white" stroke-opacity="0.18" stroke-width="1.5" />
        <path
          d="M19 46V18L45 46V18"
          [attr.stroke]="'url(#' + id + 'fg)'"
          stroke-width="4.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="19" cy="46" r="4.5" fill="#fff" />
        <circle cx="19" cy="18" r="3.5" fill="#fff" />
        <circle cx="45" cy="46" r="3.5" fill="#fff" />
        <circle cx="45" cy="18" r="4.5" fill="#5eead4" stroke="#fff" stroke-width="2" />
      </svg>
      <span
        *ngIf="wordmark"
        class="font-semibold tracking-tight text-[var(--color-text-primary)] leading-none"
        [ngClass]="textClass"
      >
        Nexus<span class="gradient-text-brand">AI</span>
      </span>
    </span>
  `,
})
export class NexusLogoComponent {
  @Input() size = 28;
  @Input() wordmark = false;
  @Input() glow = false;
  @Input() textClass = 'text-base';
  readonly id = `nx${nextLogoId++}`;
}
