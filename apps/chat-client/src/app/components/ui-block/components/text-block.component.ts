import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TextOrMarkdownData } from '@chat-monorepo/shared';

/** Renders a TEXT UIComponent - plain text, auto-escaped by interpolation. */
@Component({
  selector: 'app-ui-text-block',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './text-block.component.html',
  host: { style: 'display: contents' },
})
export class TextBlockComponent {
  @Input({ required: true }) data!: TextOrMarkdownData;
}
