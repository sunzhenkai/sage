export * from './compatibility.js';
export * from './execution-policy.js';
export type { EngineAdapter, KernelEngineResult } from '@sage/agent-lib';
import {
  isAgentRunSpec,
  isAgentTaskSpec,
  sha256Digest,
  type AgentExecutionEnvelope,
  type AgentRunSpec,
  type AgentTaskSpec,
  type HarnessCapability,
  type HarnessPort,
  type SealedCheckpointRef,
} from '@sage/agent-contracts';
import { AgentRunner, type AgentRunExecution, type CanonicalEngine, type CanonicalRunResult } from '@sage/agent-lib';
import type { AgentTaskSpecStorePort } from '@sage/platform-ports';

export * from './canonical.js';
import type { KernelClient } from './canonical.js';

/** Compatibility façade: this synchronous v1 API intentionally enters the explicit old runner. */
export interface AgentClient {
  run(spec: AgentRunSpec): AgentRunExecution;
  runCanonical<T>(input: { readonly tenantId: string; readonly envelope: AgentExecutionEnvelope; readonly engine: CanonicalEngine<T> }): Promise<CanonicalRunResult<T>>;
}

export interface LocalAgentClientOptions {
  readonly kernel?: KernelClient;
  readonly runner?: AgentRunner;
  /** Explicit compatibility-only dependency; it is never used by canonical calls. */
  readonly harness?: HarnessPort;
}

export class LocalAgentClient implements AgentClient {
  readonly #runner: AgentRunner | undefined;
  readonly #harness: HarnessPort | undefined;
  readonly #kernel: KernelClient | undefined;

  constructor(options: LocalAgentClientOptions) {
    this.#kernel = options.kernel;
    this.#harness = options.harness;
    this.#runner = options.runner ?? (options.harness === undefined ? undefined : new AgentRunner());
    if (this.#kernel === undefined && (this.#harness === undefined || this.#runner === undefined)) {
      throw new Error('AGENT_CLIENT_COMPOSITION_REQUIRED');
    }
  }

  run(spec: AgentRunSpec): AgentRunExecution {
    if (this.#runner === undefined || this.#harness === undefined) throw new Error('AGENT_CLIENT_LEGACY_PATH_UNAVAILABLE');
    return this.#runner.start(spec, this.#harness);
  }

  runCanonical<T>(input: {
    readonly tenantId: string;
    readonly envelope: AgentExecutionEnvelope;
    readonly engine: CanonicalEngine<T>;
  }): Promise<CanonicalRunResult<T>> {
    if (this.#kernel === undefined) throw new Error('AGENT_CLIENT_KERNEL_PATH_UNAVAILABLE');
    return this.#kernel.start(input);
  }
}

export type LegacyRunSource = 'agent-run-spec-v1' | 'chat-v1' | 'task-v1';

export interface LegacyAdapterTelemetryEvent {
  readonly name: 'legacy.agent_run_spec.deprecated';
  readonly legacySource: LegacyRunSource;
  readonly adapterBuild: string;
  readonly status: 'mapped' | 'rejected';
  readonly code?: LegacyAdapterErrorCode;
}

export interface LegacyAdapterTelemetry {
  record(event: LegacyAdapterTelemetryEvent): void;
}

export interface LegacyAdapterTrustedContext {
  readonly legacySource: LegacyRunSource;
  readonly adapterBuild: string;
  readonly tenantId: string;
  readonly principalRef: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly invocationId: string;
  readonly specRef: string;
  readonly goalRef: string;
  readonly releaseRef: string;
  readonly releaseDigest: string;
  readonly engineId: string;
  readonly allowedSkillRefs: readonly string[];
  readonly allowedCapabilities: readonly HarnessCapability[];
  readonly modelRouteRef: string;
  readonly contextPlanRef: string;
  readonly capabilityGrantRef: string;
  readonly executionPolicyRef: string;
  readonly boundsRef: string;
  readonly governanceRef: string;
  readonly admittedAt: string;
  readonly sealedCheckpoint?: SealedCheckpointRef;
  readonly correlationIds?: Readonly<Record<string, string>>;
}

export type LegacyAdapterErrorCode =
  | 'LEGACY_SPEC_INVALID'
  | 'LEGACY_AUTHORITY_OVERRIDE'
  | 'LEGACY_MAPPING_AMBIGUOUS'
  | 'LEGACY_CHECKPOINT_UNSEALED'
  | 'LEGACY_SPEC_CONFLICT';

export type LegacyAdapterResult =
  | {
      readonly status: 'mapped';
      readonly spec: AgentTaskSpec;
      readonly envelope: AgentExecutionEnvelope;
      readonly provenance: { readonly legacySource: LegacyRunSource; readonly adapterBuild: string; readonly deprecated: true };
    }
  | { readonly status: 'rejected'; readonly code: LegacyAdapterErrorCode };

const authorityOverrideKeys = new Set([
  'tenantId', 'principalRef', 'capabilityGrantRef', 'grant', 'runtime', 'runtimeTarget',
  'targetRef', 'targetId', 'engineId', 'releaseRef', 'releaseDigest', 'specRef', 'specDigest',
  'endpoint', 'namespace', 'taskQueue', 'provider', 'providerRef', 'modelProvider', 'model-provider',
]);

const nonBlank = (value: string): boolean => value.trim().length > 0;
const digestPattern = /^sha256:[a-f0-9]{64}$/;

/**
 * Compatibility compiler only. It never executes a legacy DTO and never derives
 * identity, grants, runtime selection or defaults from client-controlled fields.
 */
export class LegacyAgentRunSpecV1Adapter {
  constructor(private readonly options: { readonly specs: AgentTaskSpecStorePort; readonly telemetry?: LegacyAdapterTelemetry }) {}

  async adapt(legacyInput: unknown, trusted: LegacyAdapterTrustedContext, options: { readonly persistSpec?: boolean } = {}): Promise<LegacyAdapterResult> {
    const reject = (code: LegacyAdapterErrorCode): LegacyAdapterResult => {
      this.#telemetry(trusted, 'rejected', code);
      return { status: 'rejected', code };
    };

    if (legacyInput !== null && typeof legacyInput === 'object'
      && Object.keys(legacyInput).some((key) => authorityOverrideKeys.has(key))) {
      return reject('LEGACY_AUTHORITY_OVERRIDE');
    }
    if (!isAgentRunSpec(legacyInput)) return reject('LEGACY_SPEC_INVALID');

    const requiredTrustedValues = [
      trusted.adapterBuild, trusted.tenantId, trusted.principalRef, trusted.taskId,
      trusted.attemptId, trusted.invocationId, trusted.specRef, trusted.goalRef,
      trusted.releaseRef, trusted.engineId, trusted.modelRouteRef, trusted.contextPlanRef,
      trusted.capabilityGrantRef, trusted.executionPolicyRef, trusted.boundsRef,
      trusted.governanceRef, trusted.admittedAt,
    ];
    if (requiredTrustedValues.some((value) => !nonBlank(value))
      || !trusted.specRef.startsWith('spec://')
      || !trusted.releaseRef.startsWith('release://')
      || !digestPattern.test(trusted.releaseDigest)
      || Number.isNaN(Date.parse(trusted.admittedAt))) {
      return reject('LEGACY_MAPPING_AMBIGUOUS');
    }

    const allowedSkills = new Set(trusted.allowedSkillRefs);
    const allowedCapabilities = new Set(trusted.allowedCapabilities);
    if (legacyInput.skillRefs.some((ref) => !allowedSkills.has(ref))
      || legacyInput.requiredCapabilities.some((capability) => !allowedCapabilities.has(capability))) {
      return reject('LEGACY_MAPPING_AMBIGUOUS');
    }

    const checkpoint = trusted.sealedCheckpoint;
    if (legacyInput.resumeFrom !== undefined
      && (checkpoint === undefined || checkpoint.checkpointRef !== legacyInput.resumeFrom)) {
      return reject('LEGACY_CHECKPOINT_UNSEALED');
    }
    if (legacyInput.resumeFrom === undefined && checkpoint !== undefined) return reject('LEGACY_MAPPING_AMBIGUOUS');

    const unsignedSpec: AgentTaskSpec = {
      schemaVersion: '1',
      specRef: trusted.specRef,
      specDigest: `sha256:${'0'.repeat(64)}`,
      taskId: trusted.taskId,
      runId: legacyInput.runId,
      attemptId: trusted.attemptId,
      releaseRef: trusted.releaseRef,
      releaseDigest: trusted.releaseDigest,
      principalRef: trusted.principalRef,
      tenantId: trusted.tenantId,
      goalRef: trusted.goalRef,
      engineId: trusted.engineId,
      skillRefs: [...legacyInput.skillRefs],
      modelRouteRef: trusted.modelRouteRef,
      contextPlanRef: trusted.contextPlanRef,
      capabilityGrantRef: trusted.capabilityGrantRef,
      executionPolicyRef: trusted.executionPolicyRef,
      boundsRef: trusted.boundsRef,
      governanceRef: trusted.governanceRef,
      admittedAt: trusted.admittedAt,
    };
    const spec: AgentTaskSpec = {
      ...unsignedSpec,
      specDigest: sha256Digest(unsignedSpec, { excludeKeys: ['specDigest'] }),
    };
    if (!isAgentTaskSpec(spec)) return reject('LEGACY_MAPPING_AMBIGUOUS');
    if (checkpoint !== undefined && checkpoint.specDigest !== spec.specDigest) return reject('LEGACY_CHECKPOINT_UNSEALED');

    const write = options.persistSpec === false
      ? { status: 'shadow' as const, value: spec }
      : await this.options.specs.putSpec({ tenantId: trusted.tenantId, spec });
    if (write.status === 'conflict') return reject('LEGACY_SPEC_CONFLICT');
    if (write.value.specDigest !== spec.specDigest) return reject('LEGACY_SPEC_CONFLICT');

    const envelope: AgentExecutionEnvelope = {
      schemaVersion: '1', specRef: spec.specRef, specDigest: spec.specDigest,
      taskId: spec.taskId, runId: spec.runId, attemptId: spec.attemptId,
      invocationId: trusted.invocationId,
      ...(checkpoint === undefined ? {} : { checkpointRef: checkpoint.checkpointRef }),
      ...(trusted.correlationIds === undefined ? {} : { correlationIds: { ...trusted.correlationIds } }),
    };
    this.#telemetry(trusted, 'mapped');
    return {
      status: 'mapped', spec: write.value, envelope,
      provenance: { legacySource: trusted.legacySource, adapterBuild: trusted.adapterBuild, deprecated: true },
    };
  }

  #telemetry(trusted: LegacyAdapterTrustedContext, status: 'mapped' | 'rejected', code?: LegacyAdapterErrorCode): void {
    try {
      this.options.telemetry?.record({
        name: 'legacy.agent_run_spec.deprecated', legacySource: trusted.legacySource,
        adapterBuild: trusted.adapterBuild, status, ...(code === undefined ? {} : { code }),
      });
    } catch { /* Deprecation telemetry cannot alter adapter authority semantics. */ }
  }
}
