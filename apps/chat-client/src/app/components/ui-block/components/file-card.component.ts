import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FileCardData } from '@chat-monorepo/shared';

/** Renders a FILE_CARD UIComponent. */
@Component({
  selector: 'app-ui-file-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './file-card.component.html',
  host: { style: 'display: contents' },
})
export class FileCardComponent {
  @Input({ required: true }) data!: FileCardData;

  public formatBytes(bytes?: number): string {
    if (!bytes || bytes <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${value.toFixed(value < 10 && unitIndex > 0 ? 1 : 0)} ${units[unitIndex]}`;
  }
}
