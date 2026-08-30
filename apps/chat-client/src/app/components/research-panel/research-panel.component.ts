import { Component, Input, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ResearchTrace, ResearchPhase } from '@chat-monorepo/shared';

/**
 * The "Thinking" panel: what the assistant did before it wrote a word.
 *
 * Research and tool round-trips all happen ahead of the first token, so
 * without this the user watches a spinner and has no way to tell a slow
 * turn from a stuck one — or, afterwards, to check which searches an
 * answer actually rests on.
 *
 * Auto-expands while the work is in flight (that is when the detail is
 * useful) and collapses to a one-line summary once the answer arrives, so
 * a finished conversation doesn't read as a wall of machinery.
 */
@Component({
  selector: 'app-research-panel',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './research-panel.component.html',
  host: { style: 'display:block' },
})
export class ResearchPanelComponent {
  @Input({ required: true }) trace!: ResearchTrace;
  /** True while this turn is still streaming - drives auto-expansion. */
  @Input() live = false;

  private userToggled: boolean | null = null;

  get expanded(): boolean {
    // An explicit click always wins; otherwise open while working, closed
    // once there's an answer to read instead.
    return this.userToggled ?? this.live;
  }

  toggle(): void {
    this.userToggled = !this.expanded;
  }

  get isRunning(): boolean {
    return this.live && this.trace.phase !== 'done' && this.trace.phase !== 'skipped';
  }

  /** One-line summary for the collapsed header. */
  get headline(): string {
    if (this.isRunning) return this.trace.message || this.phaseLabel(this.trace.phase);
    if (!this.trace.ran) return this.trace.message || 'Answered without research';

    const searches = this.trace.queries.length;
    const sources = this.trace.sources.length;
    if (searches === 0) return 'Researched this answer';
    return `${searches} search${searches === 1 ? '' : 'es'} · ${sources} source${sources === 1 ? '' : 's'}`;
  }

  /** SVG path per running phase - a magnifying glass for "searching" reads
   *  very differently from a pencil for "writing the answer", which a single
   *  generic spinner can't convey. Only used while isRunning; the done/
   *  skipped state always shows the plain checkmark instead (see template). */
  phaseIconPath(phase: ResearchPhase): string {
    switch (phase) {
      case 'searching':
        return 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z';
      case 'browsing':
        return 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
      case 'synthesizing':
        return 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z';
      case 'planning':
        return 'M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 0a2 2 0 002 2h2a2 2 0 002-2m-6 0H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2m-5 9l2 2 4-4';
      case 'thinking':
      default:
        return 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z';
    }
  }

  phaseLabel(phase: ResearchPhase): string {
    switch (phase) {
      case 'thinking':
        return 'Thinking';
      case 'planning':
        return 'Planning searches';
      case 'searching':
        return 'Searching';
      case 'browsing':
        return 'Reading pages';
      case 'synthesizing':
        return 'Writing the answer';
      case 'skipped':
        return 'No research needed';
      default:
        return 'Done';
    }
  }

  /** Hostname is far more scannable than a full URL in a list of citations. */
  hostLabel(url: string, title?: string): string {
    const trimmed = title?.trim();
    if (trimmed) return trimmed;
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }
}
