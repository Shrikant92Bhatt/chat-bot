import { Component, EventEmitter, Input, OnInit, Output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApprovalSummary, OrchestratorAction } from '@chat-monorepo/shared';
import { ConnectorService, safeExternalUrl } from '../../../services/connector.service';

/**
 * Renders an APPROVAL_REQUEST - a connector write the server parked for the
 * user's explicit approval (apps/chat-api/src/connectors/approval-service.ts).
 *
 * Unlike CONFIRMATION_CARD this IS a real gate: Approve calls the server's
 * decision endpoint, which executes exactly the stored action once. The card
 * re-reads the approval from the server on init and shows the server's own
 * summary/details - never model-written text - so what the user approves is
 * what will run. After a decision it emits one plain-text action so the chat
 * tells the model the outcome (the model never learns it any other way).
 */
@Component({
  selector: 'app-ui-approval-request',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './approval-request.component.html',
  host: { style: 'display: contents' },
})
export class ApprovalRequestComponent implements OnInit {
  @Input({ required: true }) data!: ApprovalSummary;
  @Output() actionSelected = new EventEmitter<OrchestratorAction>();

  public approval = signal<ApprovalSummary | null>(null);
  public busy = signal<boolean>(false);
  public error = signal<string | null>(null);
  public readonly safeUrl = safeExternalUrl;

  constructor(private connectorService: ConnectorService) {}

  async ngOnInit(): Promise<void> {
    this.approval.set(this.data);
    try {
      this.approval.set(await this.connectorService.getApproval(this.data.id));
    } catch {
      // Keep the streamed copy; the decision endpoint is still authoritative.
    }
  }

  public get isPending(): boolean {
    const a = this.approval();
    return !!a && a.state === 'pending' && a.expiresAt > Date.now();
  }

  public get tierLabel(): string {
    const tier = this.approval()?.riskTier ?? 0;
    return tier >= 3 ? 'Consequential action' : 'Write action';
  }

  public async decide(decision: 'approve' | 'reject'): Promise<void> {
    const current = this.approval();
    if (!current || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const { approval, result } = await this.connectorService.decide(current.id, decision);
      this.approval.set(approval);
      const label =
        decision === 'reject'
          ? `I declined: ${approval.summary}.`
          : result?.ok
            ? `I approved and it ran: ${approval.summary}. ${approval.outcome?.message ?? ''}${approval.outcome?.url ? ` (${approval.outcome.url})` : ''}`.trim()
            : `I approved "${approval.summary}" but it failed: ${approval.outcome?.message ?? result?.error?.message ?? 'unknown error'}.`;
      this.actionSelected.emit({ id: `approval-outcome:${approval.id}`, label });
    } catch (e) {
      this.error.set((e as Error).message);
      // Refresh so a stale card (already decided elsewhere, expired) shows its real state.
      this.connectorService.getApproval(current.id).then((a) => this.approval.set(a)).catch(() => undefined);
    } finally {
      this.busy.set(false);
    }
  }
}
