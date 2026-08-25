import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfirmationCardData, OrchestratorAction } from '@chat-monorepo/shared';

/**
 * Renders a CONFIRMATION_CARD UIComponent - a confirm/cancel prompt whose
 * selected action bubbles up through `actionSelected`, wired by
 * UiBlockComponent to its own `actionSelected` output.
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
}
