import { AfterViewChecked, Component, EventEmitter, Input, OnDestroy, Output, QueryList, Type, ViewChildren } from '@angular/core';
import { CommonModule, NgComponentOutlet } from '@angular/common';
import { Subscription } from 'rxjs';
import {
  OrchestratorAction,
  OrchestratorSource,
  PendingUIBlock,
  UIComponent,
  UIComponentType,
} from '@chat-monorepo/shared';
import { TextBlockComponent } from './components/text-block.component';
import { MarkdownBlockComponent } from './components/markdown-block.component';
import { TableBlockComponent } from './components/table-block.component';
import { ChartBlockComponent } from './components/chart-block.component';
import { WeatherCardComponent } from './components/weather-card.component';
import { StockCardComponent } from './components/stock-card.component';
import { StockChartComponent } from './components/stock-chart.component';
import { NewsCardComponent } from './components/news-card.component';
import { MapBlockComponent } from './components/map-block.component';
import { ProductCardComponent } from './components/product-card.component';
import { ProductCarouselComponent } from './components/product-carousel.component';
import { FileCardComponent } from './components/file-card.component';
import { DocumentPreviewComponent } from './components/document-preview.component';
import { CodeBlockComponent } from './components/code-block.component';
import { ErrorCardComponent } from './components/error-card.component';
import { ConfirmationCardComponent } from './components/confirmation-card.component';

/** UIComponentType -> the standalone component that renders it. Every approved orchestrator type must have an entry. */
const UI_COMPONENT_REGISTRY: Record<UIComponentType, Type<object>> = {
  TEXT: TextBlockComponent,
  MARKDOWN: MarkdownBlockComponent,
  TABLE: TableBlockComponent,
  CHART: ChartBlockComponent,
  WEATHER_CARD: WeatherCardComponent,
  STOCK_CARD: StockCardComponent,
  STOCK_CHART: StockChartComponent,
  NEWS_CARD: NewsCardComponent,
  MAP: MapBlockComponent,
  PRODUCT_CARD: ProductCardComponent,
  PRODUCT_CAROUSEL: ProductCarouselComponent,
  FILE_CARD: FileCardComponent,
  DOCUMENT_PREVIEW: DocumentPreviewComponent,
  CODE_BLOCK: CodeBlockComponent,
  ERROR_CARD: ErrorCardComponent,
  CONFIRMATION_CARD: ConfirmationCardComponent,
};

/** A dynamically-rendered component that can bubble an action back up (currently only ConfirmationCardComponent). */
interface EmitsActionSelected {
  actionSelected: EventEmitter<OrchestratorAction>;
}

function emitsActionSelected(instance: unknown): instance is EmitsActionSelected {
  return (
    !!instance &&
    typeof instance === 'object' &&
    'actionSelected' in instance &&
    (instance as { actionSelected?: unknown }).actionSelected instanceof EventEmitter
  );
}

/**
 * Renders the orchestrator's approved, pre-validated UI components.
 *
 * This is the ONLY place the model's structured `ui` payload turns into
 * markup - and it never trusts that payload as markup itself. Every field
 * is bound through Angular interpolation/property binding (auto-escaped) by
 * the per-type component it's handed off to, never [innerHTML] here, except
 * MARKDOWN's own component which goes through the same marked + DOMPurify +
 * Angular-sanitizer pipeline chat-window.component.ts uses for the main
 * reply (see markdown-block.component.ts). The backend has already
 * validated the payload against a strict schema and rejected anything
 * containing HTML-looking content (see
 * apps/chat-api/src/orchestration/ui-schema.ts) - this is a second,
 * independent layer, not the only one.
 *
 * This component is a thin dynamic-component registry, not a giant
 * conditional template: each of the 16 approved UIComponentType values maps
 * to one standalone component under `./components/`, which owns its own
 * template, Tailwind markup, and any type-specific helper logic (chart
 * geometry, weather icon mapping, stock trend colors, ...). Rendering goes
 * through NgComponentOutlet with `component.data` (and, for
 * CONFIRMATION_CARD, `component.id`) bound in as inputs.
 */
@Component({
  selector: 'app-ui-block',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-block.component.html',
})
export class UiBlockComponent implements AfterViewChecked, OnDestroy {
  @Input() components: UIComponent[] = [];
  /**
   * Tool-backed components still loading or that failed mid-turn (see
   * ui-stream.interface.ts) - rendered as a lightweight skeleton/error card
   * ahead of `components`, since a loading id is by definition not in that
   * array yet. Always empty once a turn has fully completed and reloaded.
   */
  @Input() pending: PendingUIBlock[] = [];
  @Input() sources: OrchestratorSource[] = [];
  @Input() actions: OrchestratorAction[] = [];
  @Output() actionSelected = new EventEmitter<OrchestratorAction>();

  /** Every rendered `*ngComponentOutlet` instance this turn, keyed by template reference `#outlet`. */
  @ViewChildren('outlet') private outlets?: QueryList<NgComponentOutlet>;

  public readonly registry = UI_COMPONENT_REGISTRY;

  private readonly componentLabels: Partial<Record<UIComponentType, string>> = {
    WEATHER_CARD: 'weather',
    STOCK_CARD: 'stock quote',
    STOCK_CHART: 'stock chart',
    NEWS_CARD: 'news',
    MAP: 'map',
    TABLE: 'table',
    CHART: 'chart',
  };

  /** Human-readable noun for a component type, for loading/error copy. */
  public componentLabel(type: UIComponentType): string {
    return this.componentLabels[type] ?? 'data';
  }

  /** Inputs to bind onto the dynamically-created component for one UIComponent. */
  public inputsFor(component: UIComponent): Record<string, unknown> {
    if (component.type === 'CONFIRMATION_CARD') {
      return { data: component.data, id: component.id };
    }
    return { data: component.data };
  }

  // Wiring dynamic components' outputs back to this component's own `actionSelected`
  // has to happen imperatively - NgComponentOutlet only binds inputs declaratively.
  // `#outlet="ngComponentOutlet"` (exportAs) exposes each outlet's `componentInstance`,
  // which this subscribes to exactly once (tracked per-instance) the first time it's seen.
  private readonly wiredInstances = new WeakSet<EmitsActionSelected>();
  private readonly subscriptions = new Set<Subscription>();

  ngAfterViewChecked(): void {
    this.outlets?.forEach((outlet) => {
      const instance = outlet.componentInstance;
      if (emitsActionSelected(instance) && !this.wiredInstances.has(instance)) {
        this.wiredInstances.add(instance);
        this.subscriptions.add(instance.actionSelected.subscribe((action) => this.actionSelected.emit(action)));
      }
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions.clear();
  }
}
