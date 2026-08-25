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
