import { describe, expect, it } from 'vitest';
import { runCoordinatorConformance } from '@sage/platform-ports/conformance';
import type { CoordinatorStartCommand } from '@sage/platform-ports';
import { InMemoryDurableCoordinatorFake } from './coordinator.js';

const startFor = (invocationId: string): CoordinatorStartCommand => ({
  schemaVersion: '1', type: 'START', commandKey: `start-${invocationId}`, expectedRevision: 0,
  envelope: {
    schemaVersion: '1', specRef: 'spec://tenant/task', specDigest: `sha256:${'a'.repeat(64)}`,
    taskId: 'task', runId: 'run', attemptId: 'attempt', invocationId
  },
  ownerRef: 'owner://tenant/task', targetRef: 'target://coordinator/v2',
  adapterRef: 'adapter://coordinator/v2', runtimeRef: 'runtime://contract/1'
});

describe('InMemoryDurableCoordinatorFake', () => {
  it('passes the shared framework-neutral Coordinator conformance suite', async () => {
    const report = await runCoordinatorConformance('local-fake-non-production', () => new InMemoryDurableCoordinatorFake());
    expect(report.suite).toBe('coordinator-v1');
    expect(report.cases).toHaveLength(9);
    expect(report.cases.every((testCase) => testCase.status === 'PASS')).toBe(true);
  });

  it('replays the same start key and fences a late receipt', async () => {
    const fake = new InMemoryDurableCoordinatorFake('tenant');
    const start = startFor('invoke');
    expect(await fake.start(start)).toMatchObject({ status: 'applied' });
    expect(await fake.start(start)).toMatchObject({ status: 'duplicate' });
    const dispatch = await fake.command({ schemaVersion: '1', type: 'DISPATCH', commandKey: 'dispatch', expectedRevision: 1, invocationId: 'invoke' });
    expect(dispatch).toMatchObject({ status: 'applied', observation: { dispatchEpoch: 1 } });
    const stale = fake.deliverReceipt({
      dispatchEpoch: 0,
      invocationId: 'invoke',
      receipt: { schemaVersion: '1', receiptRef: 'receipt://tenant/late', receiptDigest: `sha256:${'b'.repeat(64)}`, outcome: 'COMPLETED', receiptRefs: [], artifactRefs: [] }
    });
    expect(stale.status).toBe('stale');
  });
});
