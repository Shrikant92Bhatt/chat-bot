import { describe, it, expect } from 'vitest';
import type { Response } from 'express';
import { runEmulatedPipeline, EmulatorStepEvent } from './emulator.service';

/**
 * Collects everything the pipeline writes, so the emitted stage sequence can
 * be asserted without an HTTP round trip.
 */
function fakeResponse() {
  const writes: string[] = [];
  const res = {
    setHeader: () => undefined,
    write: (chunk: string) => {
      writes.push(chunk);
      return true;
    },
    end: () => undefined,
  } as unknown as Response;

  const events = (): EmulatorStepEvent[] =>
    writes
      .filter((w) => w.startsWith('data: ') && !w.includes('[DONE]'))
      .map((w) => JSON.parse(w.slice('data: '.length).trim()));

  return { res, events, writes };
}

describe('Admin emulator: research stage', () => {
  it('reports the research stage and reaches a terminal state', async () => {
    const { res, events, writes } = fakeResponse();

    await runEmulatedPipeline('explain the difference between let and const', res);

    const research = events().filter((e) => e.stageId === 'research');
    expect(research.length).toBeGreaterThan(0);

    // A stage stuck on 'running' would leave the admin UI spinning forever -
    // the last word on the stage must always be terminal.
    expect(['completed', 'skipped', 'failed']).toContain(research[research.length - 1].status);
    expect(writes[writes.length - 1]).toContain('[DONE]');
  }, 60000);

  it('short-circuits before the planner when a query has no recency signal', async () => {
    const { res, events } = fakeResponse();

    await runEmulatedPipeline('refactor this function to use async await', res);

    const final = events()
      .filter((e) => e.stageId === 'research')
      .pop();

    expect(final?.status).toBe('skipped');
    expect(final?.inputPayload?.heuristicGatePassed).toBe(false);
    // The emulator's job is to make the cost model visible, not just the flow.
    expect(final?.outputPayload?.costAvoided).toBeTruthy();
  }, 60000);

  it('engages the planner for a query that does need live data', async () => {
    const { res, events } = fakeResponse();

    await runEmulatedPipeline('what is the latest nifty 50 outlook today', res);

    const research = events().filter((e) => e.stageId === 'research');
    expect(research[0]?.inputPayload?.heuristicGatePassed).toBe(true);

    // No search-capable gateway is configured under test, so the planner is
    // unavailable and the stage degrades - it must still say why rather than
    // silently vanishing from the pipeline view.
    const final = research[research.length - 1];
    expect(['completed', 'skipped', 'failed']).toContain(final.status);
    expect(final.outputPayload).toBeTruthy();
  }, 60000);

  it('places research after context assembly and before the tool stages', async () => {
    const { res, events } = fakeResponse();

    await runEmulatedPipeline('what is the latest news on interest rates', res);

    const order = events().map((e) => e.stageId);
    const firstIndexOf = (id: string) => order.indexOf(id);

    expect(firstIndexOf('context')).toBeGreaterThanOrEqual(0);
    expect(firstIndexOf('research')).toBeGreaterThan(firstIndexOf('context'));
    expect(firstIndexOf('web_search')).toBeGreaterThan(firstIndexOf('research'));
    expect(firstIndexOf('llm_response')).toBeGreaterThan(firstIndexOf('research'));
  }, 60000);

  it('announces the research node in the orchestration stage targets', async () => {
    const { res, events } = fakeResponse();

    await runEmulatedPipeline('hello', res);

    const orchestration = events().find(
      (e) => e.stageId === 'orchestration' && e.outputPayload?.targetNodes
    );
    expect(orchestration?.outputPayload.targetNodes).toContain('research');
  }, 60000);
});
