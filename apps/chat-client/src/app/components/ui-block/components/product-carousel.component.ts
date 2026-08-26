import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProductCarouselData } from '@chat-monorepo/shared';

/** Renders a PRODUCT_CAROUSEL UIComponent. */
@Component({
  selector: 'app-ui-product-carousel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './product-carousel.component.html',
  host: { style: 'display: contents' },
})
export class ProductCarouselComponent {
  @Input({ required: true }) data!: ProductCarouselData;
}
