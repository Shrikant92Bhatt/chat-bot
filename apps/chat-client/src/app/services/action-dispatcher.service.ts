import { Injectable } from '@angular/core';
import { OrchestratorAction } from '@chat-monorepo/shared';
import { ChatService } from './chat.service';

/**
 * Single place that turns a clicked `OrchestratorAction` (or a plain
 * suggestion label) into whatever should actually happen, keyed off
 * `action.type`. Every action call site in the client - the UI-block
 * actions/CONFIRMATION_CARD, and follow-up suggestion chips - routes through
 * here instead of each template deciding for itself.
 *
 * IMPORTANT - what this does NOT do: the backend's orchestrator never pauses
 * mid-turn waiting for a confirmation. A CONFIRMATION_CARD is just one more
 * UI component the model can emit in a reply, not a blocking gate in front
 * of some risky action already queued up server-side (see
 * apps/chat-api/src/orchestration/ui-schema.ts / graph.ts - there is no such
 * gate today). Dispatching a CONFIRM/CANCEL action sends a plain chat
 * message telling the model what the user decided, exactly like any other
 * message, so its NEXT reply can react to that decision. It does not stop
 * anything from having already happened, and it does not prevent the model
 * from acting again before seeing the reply. True "the agent won't do the
 * risky thing until you click Confirm" would need the backend to actually
 * pause the turn - out of scope for this client-only slice.
 */
@Injectable({
  providedIn: 'root',
})
export class ActionDispatcherService {
  constructor(private chatService: ChatService) {}

  /**
   * Routes one `OrchestratorAction` by its `type`:
   * - `CONFIRM` / `CANCEL`: send a message that clearly signals the user's
   *   choice (see confirmationMessage below).
   * - anything else (no `type`, or a `type` this dispatcher doesn't
   *   recognize): fall back to the original behavior - resend `label` as a
   *   new user message. This is what every pre-existing action (weather/
   *   stock follow-ups, model-emitted `actions`, ...) still gets, unchanged.
   */
  public dispatch(action: OrchestratorAction): void {
    switch (action.type) {
      case 'CONFIRM':
        void this.chatService.sendMessage(this.confirmationMessage(action, true));
        break;
      case 'CANCEL':
        void this.chatService.sendMessage(this.confirmationMessage(action, false));
        break;
      default:
        void this.chatService.sendMessage(action.label);
    }
  }

  /**
   * Routes a plain suggestion/follow-up label (suggestion chips, and
   * anything else that's just a string with no OrchestratorAction behind
   * it) through the same path as an untyped action - i.e. today's exact
   * behavior, unchanged.
   */
  public dispatchLabel(label: string): void {
    void this.chatService.sendMessage(label);
  }

  /**
   * The message sent to the backend for a CONFIRM/CANCEL action.
   * `action.label` already carries the card's own confirmLabel/cancelLabel
   * text (see ConfirmationCardComponent), which is the most specific signal
   * available, so it's used as-is when present; a generic synthesized
   * phrase is the fallback for the rare case it's empty.
   */
  private confirmationMessage(action: OrchestratorAction, confirmed: boolean): string {
    const label = action.label?.trim();
    if (label) return label;
    return confirmed ? 'Yes, proceed.' : 'No, cancel that.';
  }
}
