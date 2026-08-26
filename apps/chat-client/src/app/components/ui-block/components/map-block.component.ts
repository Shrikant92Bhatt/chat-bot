import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MapData } from '@chat-monorepo/shared';

/** Renders a MAP UIComponent as a coordinate summary + an OpenStreetMap link. */
@Component({
  selector: 'app-ui-map-block',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './map-block.component.html',
  host: { style: 'display: contents' },
})
export class MapBlockComponent {
  @Input({ required: true }) data!: MapData;

  public osmLink(lat: number, lng: number, zoom = 12): string {
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;
  }
}
