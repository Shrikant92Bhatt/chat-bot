import { Component, Input, OnChanges, OnDestroy, SimpleChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableData } from '@chat-monorepo/shared';
import { detectNumericColumns, tableDataToCsv, tableDataToTsv } from './table-csv';

/** Rows rendered before the "show more" control appears, and revealed per click after that. */
const ROWS_PER_PAGE = 20;

/** Renders a TABLE UIComponent: sticky header, numeric alignment, "load more" pagination, copy/CSV export. */
@Component({
  selector: 'app-ui-table-block',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './table-block.component.html',
  host: { style: 'display: contents' },
  styleUrls: [],
})
export class TableBlockComponent implements OnChanges, OnDestroy {
  @Input({ required: true }) data!: TableData;

  /** How many rows are currently rendered into the DOM (see ROWS_PER_PAGE / showMoreRows). */
  private readonly visibleRowCount = signal(ROWS_PER_PAGE);

  /** Transient feedback for the copy button - resets to 'idle' a couple seconds after every attempt. */
  public readonly copyState = signal<'idle' | 'copied' | 'error'>('idle');
  private copyResetTimer?: ReturnType<typeof setTimeout>;

  /** Per-column "is this predominantly numeric" flag, recomputed whenever `data` changes. */
  public numericColumns: boolean[] = [];

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['data']) return;
    // A new table (new turn, or the same slot re-rendered with different data) starts back at
    // the first page and drops any stale copy-feedback state from the previous table.
    this.visibleRowCount.set(ROWS_PER_PAGE);
    this.copyState.set('idle');
    this.numericColumns = detectNumericColumns(this.data.columns, this.data.rows);
  }

  ngOnDestroy(): void {
    clearTimeout(this.copyResetTimer);
  }

  public get visibleRows(): TableData['rows'] {
    return this.data.rows.slice(0, this.visibleRowCount());
  }

  public get remainingRowCount(): number {
    return Math.max(0, this.data.rows.length - this.visibleRowCount());
  }

  public get hasMoreRows(): boolean {
    return this.remainingRowCount > 0;
  }

  public get nextPageSize(): number {
    return Math.min(ROWS_PER_PAGE, this.remainingRowCount);
  }

  public showMoreRows(): void {
    this.visibleRowCount.update((count) => Math.min(this.data.rows.length, count + ROWS_PER_PAGE));
  }

  /** Tab-separated copy, so pasting into a spreadsheet lands as columns/rows rather than one blob of text. */
  public async copyTable(): Promise<void> {
    clearTimeout(this.copyResetTimer);
    try {
      await navigator.clipboard.writeText(tableDataToTsv(this.data));
      this.copyState.set('copied');
    } catch {
      this.copyState.set('error');
    }
    this.copyResetTimer = setTimeout(() => this.copyState.set('idle'), 2000);
  }

  public get copyButtonLabel(): string {
    switch (this.copyState()) {
      case 'copied':
        return 'Copied!';
      case 'error':
        return 'Copy failed';
      default:
        return 'Copy';
    }
  }

  /**
   * Real browser download via a Blob + object URL + a synthetically-clicked
   * `<a download>` - this runs inside the chat UI (not a sandboxed artifact
   * viewer), so a plain download is the right mechanism here, not
   * window.open.
   */
  public downloadCsv(): void {
    const csv = tableDataToCsv(this.data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = `table-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
