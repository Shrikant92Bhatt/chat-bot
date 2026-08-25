import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DocumentPreviewData } from '@chat-monorepo/shared';

/** Renders a DOCUMENT_PREVIEW UIComponent. */
@Component({
  selector: 'app-ui-document-preview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './document-preview.component.html',
  host: { style: 'display: contents' },
})
export class DocumentPreviewComponent {
  @Input({ required: true }) data!: DocumentPreviewData;
}
