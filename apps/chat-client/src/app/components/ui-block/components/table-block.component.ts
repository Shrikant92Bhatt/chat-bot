import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableData } from '@chat-monorepo/shared';

/** Renders a TABLE UIComponent. */
@Component({
  selector: 'app-ui-table-block',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './table-block.component.html',
  host: { style: 'display: contents' },
})
export class TableBlockComponent {
  @Input({ required: true }) data!: TableData;
}
