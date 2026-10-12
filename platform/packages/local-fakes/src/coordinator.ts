import {
  assertCoordinatorCommand,
  assertCoordinatorStartCommand,
  createCoordinatorReducerState,
  reduceCoordinatorCommand,
  type CoordinatorCommand,
  type CoordinatorCommandResult,
  type CoordinatorObservation,
  type CoordinatorReducerState,
  type CoordinatorStartCommand,
  type CoordinatorReceiptSummary,
  applyCoordinatorReceipt,
  type CoordinatorReceiptApplyResult,
  type DurableCoordinatorPort,
  type AdapterHealth
} from '@sage/platform-ports';

const keyFor = (observation: Pick<CoordinatorObservation, 'tenantId' | 'taskId' | 'runId' | 'attemptId' | 'specDigest'>): string =>
  [observation.tenantId, observation.taskId, observation.runId, observation.attemptId, observation.specDigest].join('\u0000');

/**
 * Non-production deterministic Coordinator fake. It exists only for canonical
 * conformance/fault tests; it has no provider, database, credential, or Temporal dependency.
 */
export class InMemoryDurableCoordinatorFake implements DurableCoordinatorPort {
  readonly #tenantId: string;
  readonly #states = new Map<string, CoordinatorReducerState>();
  #activeKey: string | undefined;

  constructor(tenantId = 'tenant-conformance') {
    this.#tenantId = tenantId;
  }

  async start(command: CoordinatorStartCommand): Promise<CoordinatorCommandResult> {
    assertCoordinatorStartCommand(command);
    const key = `${this.#tenantId}\u0000${command.envelope.taskId}\u0000${command.envelope.runId}\u0000${command.envelope.attemptId}\u0000${command.envelope.specDigest}`;
    const existing = this.#states.get(key);
    if (existing !== undefined) {
      const duplicate = reduceCoordinatorCommand(existing, command);
      this.#states.set(key, duplicate.state);
      this.#activeKey = key;
      return duplicate.result;
    }
    const initial: CoordinatorObservation = {
      schemaVersion: '1', tenantId: this.#tenantId, taskId: command.envelope.taskId, runId: command.envelope.runId,
      attemptId: command.envelope.attemptId, specDigest: command.envelope.specDigest, path: 'DURABLE_COORDINATOR_V2',
      state: 'READY', revision: 0, dispatchEpoch: 0, controlSequence: 0,
      logicalCursor: { schemaVersion: '1', cursorRef: `cursor://${this.#tenantId}/${command.envelope.taskId}/0`, sequence: 0, stateDigest: command.envelope.specDigest },
      ownerRef: command.ownerRef, targetRef: command.targetRef, adapterRef: command.adapterRef, runtimeRef: command.runtimeRef,
      receiptRefs: [], artifactRefs: []
    };
    const reduced = reduceCoordinatorCommand(createCoordinatorReducerState(initial), command);
    this.#states.set(key, reduced.state);
    this.#activeKey = key;
    return reduced.result;
  }

  async command(command: CoordinatorCommand): Promise<CoordinatorCommandResult> {
    assertCoordinatorCommand(command);
    if (this.#activeKey === undefined) throw new Error('COORDINATOR_NOT_FOUND');
    const state = this.#states.get(this.#activeKey);
    if (state === undefined) throw new Error('COORDINATOR_NOT_FOUND');
    const reduced = reduceCoordinatorCommand(state, command);
    this.#states.set(this.#activeKey, reduced.state);
    return reduced.result;
  }

  async observe(key: Parameters<DurableCoordinatorPort['observe']>[0]): Promise<CoordinatorObservation> {
    const stateKey = keyFor(key);
    const state = this.#states.get(stateKey);
    if (state === undefined) throw new Error('COORDINATOR_NOT_FOUND');
    return structuredClone(state.observation);
  }

  async health(): Promise<AdapterHealth> {
    return { healthy: true, checkedAt: '2026-08-15T00:00:00.000Z' };
  }

  /** Test-only receipt delivery hook for epoch-fencing conformance scenarios. */
  deliverReceipt(input: { readonly dispatchEpoch: number; readonly invocationId: string; readonly receipt: CoordinatorReceiptSummary }): CoordinatorReceiptApplyResult {
    if (this.#activeKey === undefined) throw new Error('COORDINATOR_NOT_FOUND');
    const state = this.#states.get(this.#activeKey);
    if (state === undefined) throw new Error('COORDINATOR_NOT_FOUND');
    const result = applyCoordinatorReceipt(state, input.dispatchEpoch, input.invocationId, input.receipt);
    this.#states.set(this.#activeKey, result.state);
    return result;
  }
}
