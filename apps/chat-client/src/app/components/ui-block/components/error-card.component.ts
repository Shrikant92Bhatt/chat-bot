import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ErrorCardData } from '@chat-monorepo/shared';

/** Renders an ERROR_CARD UIComponent. */
@Component({
  selector: 'app-ui-error-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './error-card.component.html',
  host: { style: 'display: contents' },
})
export class ErrorCardComponent {
  @Input({ required: true }) data!: ErrorCardData;
}
