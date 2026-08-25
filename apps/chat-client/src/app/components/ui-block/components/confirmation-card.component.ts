import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmationCardData, OrchestratorAction } from '@chat-monorepo/shared';

/** This card's answered state, once the user has clicked Confirm or Cancel. */
export type ConfirmationResolution = 'confirmed' | 'cancelled';

/**
 * Renders a CONFIRMATION_CARD UIComponent - a confirm/cancel prompt whose
 * selected action bubbles up through `actionSelected`, wired by
 * UiBlockComponent to its own `actionSelected` output, and routed onward by
 * ActionDispatcherService (apps/chat-client/src/app/services/
 * action-dispatcher.service.ts) - see that service's docs for exactly what
 * "confirming" does and does not do (it is NOT a backend gate on any risky
 * action; the orchestrator never pauses mid-turn).
 *
 * Locks in visually once answered: `resolved` is local component state, set
 * the instant a button is clicked, so a second click can't re-fire the
 * action and the user can see what they picked. This is NOT persisted -
 * CONFIRMATION_CARD data isn't round-tripped through ChatMessage/thread
 * storage today, so the card renders as unanswered again after a reload or
 * a regenerate. That's an acceptable limit for this slice: the actual
 * decision was already sent to the model as a chat message (see
 * ActionDispatcherService), which IS what persists.
 */
@Component({
  selector: 'app-ui-confirmation-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './confirmation-card.component.html',
  host: { style: 'display: contents' },
})
export class ConfirmationCardComponent {
  @Input({ required: true }) data!: ConfirmationCardData;
  /** The owning UIComponent's id - falls back for confirm/cancel action ids when `data.actionId` isn't set. */
  @Input() id?: string;
  @Output() actionSelected = new EventEmitter<OrchestratorAction>();

  /** null while unanswered; set the moment Confirm/Cancel is clicked - see class docs. */
  public readonly resolved = signal<ConfirmationResolution | null>(null);

  public onConfirm(): void {
    if (this.resolved()) return;
    this.resolved.set('confirmed');
    this.actionSelected.emit({
      id: (this.data.actionId || this.id) + ':confirm',
      label: this.data.confirmLabel || 'Confirm',
      type: 'CONFIRM',
    });
  }

  public onCancel(): void {
    if (this.resolved()) return;
    this.resolved.set('cancelled');
    this.actionSelected.emit({
      id: (this.data.actionId || this.id) + ':cancel',
      label: this.data.cancelLabel || 'Cancel',
      type: 'CANCEL',
    });
  }
}
