import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NewsCardData } from '@chat-monorepo/shared';

/** Renders a NEWS_CARD UIComponent. */
@Component({
  selector: 'app-ui-news-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './news-card.component.html',
  host: { style: 'display: contents' },
})
export class NewsCardComponent {
  @Input({ required: true }) data!: NewsCardData;
}
