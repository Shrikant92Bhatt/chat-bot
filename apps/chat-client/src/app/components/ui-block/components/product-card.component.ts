import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProductCardData } from '@chat-monorepo/shared';

/** Renders a PRODUCT_CARD UIComponent. */
@Component({
  selector: 'app-ui-product-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './product-card.component.html',
  host: { style: 'display: contents' },
})
export class ProductCardComponent {
  @Input({ required: true }) data!: ProductCardData;
}
