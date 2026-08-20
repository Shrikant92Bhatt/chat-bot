/**
 * The UI-aware orchestrator's structured response contract.
 *
 * The assistant's normal Markdown reply stays exactly as it is today
 * (ChatMessage.content, streamed token by token). Optionally, when a
 * pre-approved interactive component genuinely improves the answer, the
 * backend also attaches a small `ui` payload — parsed server-side from a
 * trailing fenced block the model appends to its reply (see
 * apps/chat-api/src/orchestration/ui-schema.ts) — that the frontend renders
 * using its own components. The model never emits HTML/JS/Angular
 * templates; it only ever selects one of these approved types and supplies
 * the data for it.
 */

export type UIComponentType =
  | 'TEXT'
  | 'MARKDOWN'
  | 'TABLE'
  | 'CHART'
  | 'WEATHER_CARD'
  | 'STOCK_CARD'
  | 'STOCK_CHART'
  | 'NEWS_CARD'
  | 'MAP'
  | 'PRODUCT_CARD'
  | 'PRODUCT_CAROUSEL'
  | 'FILE_CARD'
  | 'DOCUMENT_PREVIEW'
  | 'CODE_BLOCK'
  | 'ERROR_CARD'
  | 'CONFIRMATION_CARD';

export interface TextOrMarkdownData {
  text: string;
}

export interface TableData {
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

export type ChartKind = 'line' | 'bar' | 'pie' | 'area' | 'scatter';

export interface ChartSeries {
  name: string;
  data: number[];
}

export interface ChartData {
  chartType: ChartKind;
  title?: string;
  xAxis: Array<string | number>;
  series: ChartSeries[];
}

export interface WeatherForecastDay {
  date: string;
  temperatureHigh: number;
  temperatureLow: number;
  condition: string;
  precipitationProbability: number;
}

export interface WeatherCardData {
  location: string;
  current: {
    temperature: number;
    condition: string;
    humidity: number;
    windSpeed: number;
  };
  forecast?: WeatherForecastDay[];
}

export interface StockCardData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
}

export interface StockChartPoint {
  timestamp: string;
  price: number;
}

export interface StockChartData {
  symbol: string;
  name?: string;
  currency?: string;
  interval?: string;
  points: StockChartPoint[];
}

export interface NewsArticle {
  title: string;
  source?: string;
  url?: string;
  publishedAt?: string;
  summary?: string;
  imageUrl?: string;
}

export interface NewsCardData {
  articles: NewsArticle[];
}

export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
}

export interface MapData {
  center: { lat: number; lng: number };
  zoom?: number;
  markers?: MapMarker[];
}

export interface ProductData {
  name: string;
  price?: number;
  currency?: string;
  imageUrl?: string;
  url?: string;
  rating?: number;
  description?: string;
}

export type ProductCardData = ProductData;

export interface ProductCarouselData {
  products: ProductData[];
}

export interface FileCardData {
  fileName: string;
  fileType?: string;
  sizeBytes?: number;
  url?: string;
}

export interface DocumentPreviewData {
  fileName: string;
  excerpt?: string;
  pageCount?: number;
  url?: string;
}

export interface CodeBlockData {
  language: string;
  code: string;
  fileName?: string;
}

export interface ErrorCardData {
  title: string;
  message: string;
  toolName?: string;
}

export interface ConfirmationCardData {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  actionId?: string;
}

/** Discriminated union: every approved UI component the orchestrator may return. */
export type UIComponent =
  | { type: 'TEXT'; id: string; data: TextOrMarkdownData }
  | { type: 'MARKDOWN'; id: string; data: TextOrMarkdownData }
  | { type: 'TABLE'; id: string; data: TableData }
  | { type: 'CHART'; id: string; data: ChartData }
  | { type: 'WEATHER_CARD'; id: string; data: WeatherCardData }
  | { type: 'STOCK_CARD'; id: string; data: StockCardData }
  | { type: 'STOCK_CHART'; id: string; data: StockChartData }
  | { type: 'NEWS_CARD'; id: string; data: NewsCardData }
  | { type: 'MAP'; id: string; data: MapData }
  | { type: 'PRODUCT_CARD'; id: string; data: ProductCardData }
  | { type: 'PRODUCT_CAROUSEL'; id: string; data: ProductCarouselData }
  | { type: 'FILE_CARD'; id: string; data: FileCardData }
  | { type: 'DOCUMENT_PREVIEW'; id: string; data: DocumentPreviewData }
  | { type: 'CODE_BLOCK'; id: string; data: CodeBlockData }
  | { type: 'ERROR_CARD'; id: string; data: ErrorCardData }
  | { type: 'CONFIRMATION_CARD'; id: string; data: ConfirmationCardData };

export interface OrchestratorSource {
  title?: string;
  url?: string;
}

export interface OrchestratorAction {
  id: string;
  label: string;
  type?: string;
}
