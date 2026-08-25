import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CodeBlockData } from '@chat-monorepo/shared';

/** Renders a CODE_BLOCK UIComponent. */
@Component({
  selector: 'app-ui-code-block',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './code-block.component.html',
  host: { style: 'display: contents' },
})
export class CodeBlockComponent {
  @Input({ required: true }) data!: CodeBlockData;
}
