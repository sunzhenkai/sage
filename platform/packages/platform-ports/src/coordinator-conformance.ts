import { sha256Digest } from '@sage/agent-contracts';
import type {
  CoordinatorCommandResult,
  CoordinatorObservation,
  CoordinatorStartCommand,
  DurableCoordinatorPort
} from './index.js';

export interface CoordinatorConformanceCase {
  readonly id: string;
  readonly status: 'PASS';
}

export interface CoordinatorConformanceReport {
  readonly suite: 'coordinator-v1';
  readonly adapterName: string;
  readonly cases: readonly CoordinatorConformanceCase[];
}

const assertApplied = (result: CoordinatorCommandResult, id: string): CoordinatorObservation => {
  if (result.status !== 'applied' && result.status !== 'duplicate') throw new Error(`COORDINATOR_CONFORMANCE_FAILED:${id}`);
  return result.observation;
};

/**
 * framework-neutral conformance runner. It intentionally has no test framework,
 * clock, network, vendor DTO, or local-fake dependency so an Adapter can reuse it.
 */
export async function runCoordinatorConformance(
  adapterName: string,
  create: () => DurableCoordinatorPort
): Promise<CoordinatorConformanceReport> {
  const adapter = create();
  const digest = sha256Digest({ suite: 'coordinator-v1', adapterName });
  const start: CoordinatorStartCommand = {
    schemaVersion: '1', type: 'START', commandKey: 'conformance-start', expectedRevision: 0,
    envelope: {
      schemaVersion: '1', specRef: 'spec://conformance/coordinator', specDigest: digest,
      taskId: 'coordinator-task', runId: 'coordinator-run', attemptId: 'coordinator-attempt', invocationId: 'invoke-1'
    },
    ownerRef: 'owner://conformance/coordinator', targetRef: 'target://conformance/coordinator',
    adapterRef: 'adapter://conformance/coordinator', runtimeRef: 'runtime://contract/1'
  };
  const cases: CoordinatorConformanceCase[] = [];
  let observation = assertApplied(await adapter.start(start), 'start');
  cases.push({ id: 'start', status: 'PASS' });

  const dispatch = { schemaVersion: '1' as const, type: 'DISPATCH' as const, commandKey: 'conformance-dispatch', expectedRevision: observation.revision, invocationId: 'invoke-1' };
  observation = assertApplied(await adapter.command(dispatch), 'dispatch');
  if (observation.state !== 'DISPATCHED' || observation.dispatchEpoch !== 1) throw new Error('COORDINATOR_CONFORMANCE_FAILED:dispatch-epoch');
  cases.push({ id: 'dispatch-epoch', status: 'PASS' });

  const wait = { schemaVersion: '1' as const, type: 'WAIT' as const, commandKey: 'conformance-wait', expectedRevision: observation.revision };
  observation = assertApplied(await adapter.command(wait), 'wait');
  if (observation.state !== 'WAITING') throw new Error('COORDINATOR_CONFORMANCE_FAILED:wait');
  cases.push({ id: 'wait', status: 'PASS' });

  const pause = { schemaVersion: '1' as const, type: 'PAUSE' as const, commandKey: 'conformance-pause', expectedRevision: observation.revision, controlSequence: 1 };
  observation = assertApplied(await adapter.command(pause), 'pause');
  if (observation.state !== 'PAUSED' || observation.requestedControl !== 'PAUSE' || observation.effectiveControl !== 'PAUSE') throw new Error('COORDINATOR_CONFORMANCE_FAILED:pause-control');
  cases.push({ id: 'requested-effective-pause', status: 'PASS' });

  const resume = { schemaVersion: '1' as const, type: 'RESUME' as const, commandKey: 'conformance-resume', expectedRevision: observation.revision, controlSequence: 2 };
  observation = assertApplied(await adapter.command(resume), 'resume');
  if (observation.state !== 'WAITING' || observation.controlSequence !== 2) throw new Error('COORDINATOR_CONFORMANCE_FAILED:resume-control');
  cases.push({ id: 'resume-control-sequence', status: 'PASS' });

  const duplicate = await adapter.command({ ...resume });
  if (duplicate.status !== 'duplicate') throw new Error('COORDINATOR_CONFORMANCE_FAILED:idempotent-command');
  cases.push({ id: 'idempotent-command-key', status: 'PASS' });

  const cancel = { schemaVersion: '1' as const, type: 'CANCEL' as const, commandKey: 'conformance-cancel', expectedRevision: observation.revision, controlSequence: 3 };
  observation = assertApplied(await adapter.command(cancel), 'cancel');
  if (observation.state !== 'CANCELLED') throw new Error('COORDINATOR_CONFORMANCE_FAILED:terminal-cancel');
  cases.push({ id: 'terminal-cancel', status: 'PASS' });

  const latePause = await adapter.command({ schemaVersion: '1', type: 'PAUSE', commandKey: 'conformance-late-pause', expectedRevision: observation.revision, controlSequence: 4 });
  if (latePause.status !== 'conflict' || latePause.code !== 'INVALID_TRANSITION') throw new Error('COORDINATOR_CONFORMANCE_FAILED:terminal-precedence');
  cases.push({ id: 'terminal-precedence', status: 'PASS' });

  const observed = await adapter.observe({ tenantId: 'tenant-conformance', taskId: start.envelope.taskId, runId: start.envelope.runId, attemptId: start.envelope.attemptId, specDigest: digest });
  if (observed === undefined || observed.state !== 'CANCELLED' || observed.revision !== observation.revision) throw new Error('COORDINATOR_CONFORMANCE_FAILED:observation');
  cases.push({ id: 'bounded-observation', status: 'PASS' });

  return { suite: 'coordinator-v1', adapterName, cases };
}
