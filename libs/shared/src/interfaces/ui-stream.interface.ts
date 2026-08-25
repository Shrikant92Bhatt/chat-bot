import { UIComponentType } from './orchestrator.interface';

/**
 * Progressive UI streaming: lets a tool-backed structured component (a
 * WEATHER_CARD from get_weather, a STOCK_CARD from get_stock_quote, ...)
 * appear the moment the tool call happens rather than only at the very end
 * of the reply, when the model finishes its trailing ```ui fenced block
 * (see orchestration/ui-schema.ts).
 *
 * Mirrors the pattern already established for research progress
 * (research.interface.ts's ResearchStreamEvent, dispatched via
 * dispatchCustomEvent and forwarded by orchestration/graph.ts): a small
 * discriminated union of lifecycle events, folded client-side into
 * transient per-message state (see ChatMessage.pendingUi below) rather than
 * a new persisted field. The fenced-block path is unchanged and stays the
 * source of truth for every component type a tool doesn't back directly.
 */
export type UIComponentStatus = 'loading' | 'error';

export type UIStreamEvent =
  | { type: 'ui_start'; id: string; componentType: UIComponentType }
  | { type: 'ui_update'; id: string; componentType: UIComponentType; data: unknown }
  | { type: 'ui_error'; id: string; componentType: UIComponentType; message: string };

/** The name UI stream events are dispatched under, shared by emitter and reader. */
export const UI_STREAM_EVENT_NAME = 'ui_stream';

/**
 * Client-side placeholder for a component whose data hasn't arrived (or
 * failed) yet. Rendered by app-ui-block ahead of/alongside the completed
 * `ChatMessage.ui` components, and dropped once the turn's final `ui`
 * payload is attached (see ChatService.setMessageUi) - so it's always
 * transient, never itself persisted.
 */
export interface PendingUIBlock {
  id: string;
  componentType: UIComponentType;
  status: UIComponentStatus;
  errorMessage?: string;
}
