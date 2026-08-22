import { z } from 'zod';
import { OrchestratorAction, OrchestratorSource, UIComponent } from '@chat-monorepo/shared';

/**
 * Runtime contract for the orchestrator's structured UI payload.
 *
 * The model is instructed (ui_orchestrator:v1 in prompt/templates.ts) to
 * append AT MOST one fenced ```ui block to the end of its reply, containing
 * ONLY approved component types with the exact fields each one needs. This
 * module is the trust boundary: everything the model writes is untrusted
 * input, so a malformed, oversized, or unapproved payload is dropped
 * (fail-closed — the user still gets the plain-text reply) rather than
 * partially rendered or repaired.
 */

const textOrMarkdownData = z.object({ text: z.string() });

const tableData = z.object({
  columns: z.array(z.string()).min(1).max(20),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()])).max(20)).max(200),
});

const chartData = z.object({
  chartType: z.enum(['line', 'bar', 'pie', 'area', 'scatter']),
  title: z.string().optional(),
  xAxis: z.array(z.union([z.string(), z.number()])).min(1).max(100),
  series: z
    .array(
      z.object({
        name: z.string(),
        data: z.array(z.number()).max(100),
      })
    )
    .min(1)
    .max(12),
});

const weatherCardData = z.object({
  location: z.string(),
  current: z.object({
    temperature: z.number(),
    condition: z.string(),
    humidity: z.number(),
    windSpeed: z.number(),
  }),
  forecast: z
    .array(
      z.object({
        date: z.string(),
        temperatureHigh: z.number(),
        temperatureLow: z.number(),
        condition: z.string(),
        precipitationProbability: z.number(),
      })
    )
    .max(14)
    .optional(),
  /** Short-range hourly trend for the temperature sparkline under the forecast strip. */
  hourly: z
    .array(
      z.object({
        time: z.string(),
        temperature: z.number(),
      })
    )
    .max(12)
    .optional(),
});

const stockCardData = z.object({
  symbol: z.string(),
  name: z.string(),
  price: z.number(),
  change: z.number(),
  changePercent: z.number(),
  currency: z.string(),
});

const stockChartData = z.object({
  symbol: z.string(),
  name: z.string().optional(),
  currency: z.string().optional(),
  interval: z.string().optional(),
  points: z
    .array(
      z.object({
        timestamp: z.string(),
        price: z.number(),
      })
    )
    .min(1)
    .max(500),
});

const newsCardData = z.object({
  articles: z
    .array(
      z.object({
        title: z.string(),
        source: z.string().optional(),
        url: z.string().optional(),
        publishedAt: z.string().optional(),
        summary: z.string().optional(),
        imageUrl: z.string().optional(),
      })
    )
    .min(1)
    .max(10),
});

const mapData = z.object({
  center: z.object({ lat: z.number(), lng: z.number() }),
  zoom: z.number().optional(),
  markers: z
    .array(
      z.object({
        lat: z.number(),
        lng: z.number(),
        label: z.string().optional(),
      })
    )
    .max(20)
    .optional(),
});

const productData = z.object({
  name: z.string(),
  price: z.number().optional(),
  currency: z.string().optional(),
  imageUrl: z.string().optional(),
  url: z.string().optional(),
  rating: z.number().optional(),
  description: z.string().optional(),
});

const productCarouselData = z.object({ products: z.array(productData).min(1).max(20) });

const fileCardData = z.object({
  fileName: z.string(),
  fileType: z.string().optional(),
  sizeBytes: z.number().optional(),
  url: z.string().optional(),
});

const documentPreviewData = z.object({
  fileName: z.string(),
  excerpt: z.string().optional(),
  pageCount: z.number().optional(),
  url: z.string().optional(),
});

const codeBlockData = z.object({
  language: z.string(),
  code: z.string(),
  fileName: z.string().optional(),
});

const errorCardData = z.object({
  title: z.string(),
  message: z.string(),
  toolName: z.string().optional(),
});

const confirmationCardData = z.object({
  title: z.string(),
  description: z.string().optional(),
  confirmLabel: z.string().optional(),
  cancelLabel: z.string().optional(),
  actionId: z.string().optional(),
});

const idField = z.string().min(1).max(80);

const uiComponentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TEXT'), id: idField, data: textOrMarkdownData }),
  z.object({ type: z.literal('MARKDOWN'), id: idField, data: textOrMarkdownData }),
  z.object({ type: z.literal('TABLE'), id: idField, data: tableData }),
  z.object({ type: z.literal('CHART'), id: idField, data: chartData }),
  z.object({ type: z.literal('WEATHER_CARD'), id: idField, data: weatherCardData }),
  z.object({ type: z.literal('STOCK_CARD'), id: idField, data: stockCardData }),
  z.object({ type: z.literal('STOCK_CHART'), id: idField, data: stockChartData }),
  z.object({ type: z.literal('NEWS_CARD'), id: idField, data: newsCardData }),
  z.object({ type: z.literal('MAP'), id: idField, data: mapData }),
  z.object({ type: z.literal('PRODUCT_CARD'), id: idField, data: productData }),
  z.object({ type: z.literal('PRODUCT_CAROUSEL'), id: idField, data: productCarouselData }),
  z.object({ type: z.literal('FILE_CARD'), id: idField, data: fileCardData }),
  z.object({ type: z.literal('DOCUMENT_PREVIEW'), id: idField, data: documentPreviewData }),
  z.object({ type: z.literal('CODE_BLOCK'), id: idField, data: codeBlockData }),
  z.object({ type: z.literal('ERROR_CARD'), id: idField, data: errorCardData }),
  z.object({ type: z.literal('CONFIRMATION_CARD'), id: idField, data: confirmationCardData }),
]);

const sourceSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
});

const actionSchema = z.object({
  id: idField,
  label: z.string(),
  type: z.string().optional(),
});

export const orchestratorUiPayloadSchema = z.object({
  ui: z.array(uiComponentSchema).max(6).default([]),
  sources: z.array(sourceSchema).max(10).optional().default([]),
  actions: z.array(actionSchema).max(6).optional().default([]),
});

export interface OrchestratorUiPayload {
  ui: UIComponent[];
  sources: OrchestratorSource[];
  actions: OrchestratorAction[];
}

/** Matches an HTML/XML-ish tag anywhere in a string — our defense against the
 * model trying to smuggle markup or script content through a data field. */
const MARKUP_PATTERN = /<\/?[a-z!][^>]*>/i;

function containsUnsafeMarkup(value: unknown): boolean {
  if (typeof value === 'string') return MARKUP_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(containsUnsafeMarkup);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(containsUnsafeMarkup);
  return false;
}

const UI_FENCE_PATTERN = /```ui\s*([\s\S]*?)```/;

/**
 * Extracts and validates the orchestrator's trailing ```ui fenced block from
 * a completed model reply. Returns null (never throws) whenever the block is
 * absent, malformed, unapproved, or looks like it's carrying markup — the
 * caller always has a safe plain-text reply to fall back to.
 */
export function extractOrchestratorUiBlock(rawText: string): OrchestratorUiPayload | null {
  const match = rawText.match(UI_FENCE_PATTERN);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch (error) {
    console.warn('[orchestration/ui-schema] Failed to parse ```ui block as JSON:', error);
    return null;
  }

  if (containsUnsafeMarkup(parsed)) {
    console.warn('[orchestration/ui-schema] Dropped ```ui block: contains markup-like content.');
    return null;
  }

  const result = orchestratorUiPayloadSchema.safeParse(parsed);
  if (!result.success) {
    console.warn('[orchestration/ui-schema] ```ui block failed schema validation:', result.error.message);
    return null;
  }

  const { ui, sources, actions } = result.data;
  if (ui.length === 0 && sources.length === 0 && actions.length === 0) return null;

  // Component ids must be unique within a reply — the frontend keys on them.
  const seenIds = new Set<string>();
  for (const component of ui) {
    if (seenIds.has(component.id)) {
      console.warn(`[orchestration/ui-schema] Dropped UI block: duplicate component id "${component.id}".`);
      return null;
    }
    seenIds.add(component.id);
  }

  return { ui: ui as UIComponent[], sources, actions };
}
