import { describe, expect, it, vi } from 'vitest';
import { ApprovalSummary, UIComponent } from '@chat-monorepo/shared';
import { ConnectorService, connectorErrorMessage, safeExternalUrl } from './connector.service';
import { ApprovalRequestComponent } from '../components/ui-block/components/approval-request.component';
import { ConnectorResultComponent } from '../components/ui-block/components/connector-result.component';
import { ResponseRendererService } from './response-renderer.service';

const approval = (overrides: Partial<ApprovalSummary> = {}): ApprovalSummary => ({
  id: 'ap-1',
  connectorId: 'github',
  toolName: 'github_create_issue',
  riskTier: 2,
  state: 'pending',
  summary: 'Create issue "Bug" in o/r',
  target: 'o/r',
  details: [{ label: 'Title', value: 'Bug' }],
  createdAt: Date.now(),
  expiresAt: Date.now() + 60_000,
  ...overrides,
});

function stubService(partial: Partial<ConnectorService>): ConnectorService {
  return partial as ConnectorService;
}

describe('connector helpers', () => {
  it('only allows http(s) links from provider data', () => {
    expect(safeExternalUrl('https://github.com/o/r')).toBe('https://github.com/o/r');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html,hi')).toBeNull();
    expect(safeExternalUrl(undefined)).toBeNull();
  });

  it('maps OAuth callback codes to friendly copy without echoing raw input', () => {
    expect(connectorErrorMessage('InvalidState')).toMatch(/expired/);
    expect(connectorErrorMessage('<script>')).toBe('Something went wrong while connecting. Please try again.');
  });
});

describe('ApprovalRequestComponent', () => {
  it('shows the server copy of the approval, not the streamed one', async () => {
    const fresh = approval({ summary: 'Server truth' });
    const component = new ApprovalRequestComponent(stubService({ getApproval: vi.fn().mockResolvedValue(fresh) }));
    component.data = approval({ summary: 'Streamed copy' });
    await component.ngOnInit();
    expect(component.approval()?.summary).toBe('Server truth');
    expect(component.isPending).toBe(true);
  });

  it('approves through the server and reports the outcome to the chat', async () => {
    const executed = approval({ state: 'executed', outcome: { ok: true, message: 'Created o/r#12', url: 'https://github.com/o/r/issues/12' } });
    const decide = vi.fn().mockResolvedValue({ approval: executed, result: { ok: true } });
    const component = new ApprovalRequestComponent(stubService({ getApproval: vi.fn().mockResolvedValue(approval()), decide }));
    component.data = approval();
    await component.ngOnInit();
    const emitted: string[] = [];
    component.actionSelected.subscribe((a) => emitted.push(a.label));

    await component.decide('approve');
    expect(decide).toHaveBeenCalledWith('ap-1', 'approve');
    expect(component.approval()?.state).toBe('executed');
    expect(component.isPending).toBe(false);
    expect(emitted[0]).toContain('I approved and it ran');
    expect(emitted[0]).toContain('https://github.com/o/r/issues/12');
  });

  it('treats an expired approval as not actionable', async () => {
    const component = new ApprovalRequestComponent(stubService({ getApproval: vi.fn().mockRejectedValue(new Error('x')) }));
    component.data = approval({ expiresAt: Date.now() - 1 });
    await component.ngOnInit();
    expect(component.isPending).toBe(false);
  });

  it('surfaces a failed decision and refreshes the real state', async () => {
    const getApproval = vi.fn().mockResolvedValueOnce(approval()).mockResolvedValueOnce(approval({ state: 'executed' }));
    const component = new ApprovalRequestComponent(
      stubService({ getApproval, decide: vi.fn().mockRejectedValue(new Error('This request was already executed.')) })
    );
    component.data = approval();
    await component.ngOnInit();
    await component.decide('approve');
    await Promise.resolve();
    expect(component.error()).toBe('This request was already executed.');
    expect(getApproval).toHaveBeenCalledTimes(2);
  });
});

describe('ConnectorResultComponent', () => {
  it('distinguishes empty, error-with-reconnect and data states', () => {
    const c = new ConnectorResultComponent();
    c.data = { connectorId: 'github', toolName: 'github_search_issues', status: 'empty', display: { title: 't', items: [] } };
    expect(c.isEmpty).toBe(true);
    expect(c.connectorName).toBe('GitHub');

    c.data = { connectorId: 'gmail', toolName: 'gmail_search_threads', status: 'error', error: { code: 'NOT_CONNECTED', message: 'Connect it' } };
    expect(c.needsReconnect).toBe(true);
    expect(c.isEmpty).toBe(false);

    c.data = { connectorId: 'github', toolName: 'x', status: 'success', display: { title: 't', items: [{ title: 'a' }] } };
    expect(c.isEmpty).toBe(false);
  });
});

describe('ResponseRendererService validation for connector components', () => {
  const renderer = new ResponseRendererService();

  it('accepts well-formed connector components and rejects malformed ones', () => {
    const ok: UIComponent = { type: 'CONNECTOR_RESULT', id: 'c', data: { connectorId: 'github', toolName: 'x', status: 'success' } };
    expect(renderer.validateComponent(ok)).toBe(true);
    expect(renderer.validateComponent({ type: 'APPROVAL_REQUEST', id: 'a', data: approval() })).toBe(true);
    expect(renderer.validateComponent({ type: 'APPROVAL_REQUEST', id: 'a', data: { id: 'x' } } as unknown as UIComponent)).toBe(false);
    expect(
      renderer.validateComponent({ type: 'CONNECTOR_RESULT', id: 'c', data: { connectorId: 'g', toolName: 'x', status: 'weird' } } as unknown as UIComponent)
    ).toBe(false);
  });
});
