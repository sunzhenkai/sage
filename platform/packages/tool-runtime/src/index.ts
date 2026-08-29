import { createHash, randomUUID } from 'node:crypto';
import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import {
  assertNoSensitiveData,
  assertToolCorrelation,
  type AdapterHealth,
  type ArtifactAdapter,
  type ArtifactRef,
  type CapabilityBrokerPort,
  type CapabilityDescriptor,
  type CapabilityObservation,
  type CapabilityRequest,
  type ConnectionRef,
  type CredentialProvider,
  type Environment,
  type RuntimeIdentity,
  type BoundedRuntimePayload,
  type IdempotencyStore,
  type ProductionAuthorizationPort,
  type ProductionConsumptionLedgerPort,
  type ToolEffectLedgerPort,
  type SecretRef,
  type ToolCorrelation} from '@sage/platform-ports';
import { AuthorizationReceiptSchema, type AuthorizationReceipt, type UsageReservationV1 } from '@sage/agent-contracts';
import { productionSandboxProfile, type ProductionToolExecutorPort } from './sandbox.js';

export const ToolAccessSchema = Type.Union([Type.Literal('read'), Type.Literal('write')]);
export const ToolRiskSchema = Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]);
export const ToolDefinitionSchema = Type.Object({
  id: Type.String({ pattern: '^tool://[a-z0-9-]+/v[0-9]+$' }),
  version: Type.String({ pattern: '^[0-9]+$' }),
  access: ToolAccessSchema,
  risk: ToolRiskSchema,
  defaultAllowlisted: Type.Boolean(),
  timeoutMs: Type.Integer({ minimum: 1, maximum: 300_000 }),
  restrictedOutput: Type.Boolean(),
  requiresCredential: Type.Boolean(),
  credentialScope: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  inputSchema: Type.Record(Type.String(), Type.Unknown())
}, { additionalProperties: false, $id: 'ToolDefinition.v1' });
export type ToolDefinitionShape = Static<typeof ToolDefinitionSchema>;

export const SkillDefinitionSchema = Type.Object({
  id: Type.String({ pattern: '^skill://[a-z0-9-]+/v[0-9]+$' }),
  version: Type.String({ pattern: '^[0-9]+$' }),
  toolRefs: Type.Array(Type.String({ pattern: '^tool://' }), { uniqueItems: true })
}, { additionalProperties: false, $id: 'SkillDefinition.v1' });
export type SkillDefinition = Static<typeof SkillDefinitionSchema>;

export interface ToolDefinition extends Omit<ToolDefinitionShape, 'inputSchema'> {
  readonly inputSchema: TSchema;
  readonly execute: ToolExecutor;
  readonly production?: { readonly executableRef: string; readonly network: 'none' | 'egress-proxy-only'; readonly egressUrls?: (input: unknown) => readonly string[] };
}

export interface ToolExecutionContext {
  readonly tenantId: string;
  readonly environment: Environment;
  readonly correlation: Correlation;
  readonly idempotencyKey?: string;
  readonly credential?: Uint8Array;
  readonly signal: AbortSignal;
}

export type ToolExecutor = (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
export type Correlation = ToolCorrelation;

export interface AuthorizationRequest {
  readonly toolId: string;
  readonly access: 'read' | 'write';
  readonly risk: 'low' | 'medium' | 'high';
  readonly tenantId: string;
  readonly input: unknown;
}

export interface ToolAuthorizer {
  authorize(request: AuthorizationRequest): Promise<{ readonly allowed: boolean; readonly reason?: string }>;
}

export interface ToolEvent {
  readonly type: 'tool.denied' | 'tool.completed' | 'tool.failed' | 'tool.effect_unknown';
  readonly toolId: string;
  readonly status: ToolResult['status'];
  readonly correlation: Correlation;
  readonly occurredAt: string;
  readonly idempotencyKey?: string;
  readonly artifact_ref?: ArtifactRef;
  readonly code?: string;
}

export interface ToolEventRecorder { record(event: ToolEvent): Promise<void>; }

export type ToolResult =
  | { readonly status: 'succeeded'; readonly output?: unknown; readonly artifact_ref?: ArtifactRef; readonly effectReceiptRef?: string; readonly duplicate?: boolean }
  | { readonly status: 'denied' | 'invalid' | 'failed'; readonly code: string; readonly retryable: boolean; readonly duplicate?: boolean }
  | { readonly status: 'effect_unknown'; readonly code: 'EFFECT_UNKNOWN'; readonly retryable: false; readonly effectReceiptRef?: string; readonly duplicate?: boolean };

export interface ToolCall {
  readonly toolId: string;
  readonly input: unknown;
  readonly tenantId: string;
  readonly environment: Environment;
  readonly correlation: Correlation;
  readonly idempotencyKey?: string;
  readonly secret_ref?: SecretRef;
  readonly connection_ref?: ConnectionRef;
  readonly effectIdentity?: {
    readonly semanticActionId: `sha256:${string}`; readonly taskId: string; readonly attemptCompatibleActionKey: string;
    readonly toolVersion: string; readonly providerRef: string; readonly providerBuildDigest: `sha256:${string}`;
    readonly canonicalInputDigest: `sha256:${string}`; readonly invocationId: string; readonly executorRef: string;
  };
  readonly productionAuthority?: {
    readonly principalRef: string; readonly specRef: string; readonly grantRef: string; readonly approvalRef?: string;
    readonly releaseRef?: string; readonly modelRouteRef?: string; readonly resourceScopes: readonly string[];
    readonly accountRef: string; readonly upperBound: Readonly<Record<string, number>>;
    readonly requestedCount: number; readonly requestedCost: number;
  };
}

export class ToolExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly commit: 'none' | 'committed' | 'unknown',
    readonly retryable: boolean
  ) { super(message); }
}

export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>();
  readonly #skills = new Map<string, SkillDefinition>();

  registerTool(tool: ToolDefinition): void {
    const shape = { ...tool, execute: undefined, production: undefined } as Record<string, unknown>;
    delete shape.execute;
    delete shape.production;
    if (!Value.Check(ToolDefinitionSchema, shape)) throw new Error('INVALID_TOOL_DEFINITION');
    if (tool.defaultAllowlisted && (tool.access !== 'read' || tool.risk !== 'low')) throw new Error('UNSAFE_DEFAULT_ALLOWLIST');
    if (tool.requiresCredential !== (tool.credentialScope !== undefined)) throw new Error('INVALID_CREDENTIAL_SCOPE');
    if (tool.production !== undefined && (tool.production.executableRef.trim().length === 0 || !['none', 'egress-proxy-only'].includes(tool.production.network))) throw new Error('INVALID_PRODUCTION_TOOL_DEFINITION');
    if (this.#tools.has(tool.id)) throw new Error('DUPLICATE_TOOL');
    this.#tools.set(tool.id, tool);
  }

  registerSkill(skill: SkillDefinition): void {
    if (!Value.Check(SkillDefinitionSchema, skill)) throw new Error('INVALID_SKILL_DEFINITION');
    if (skill.toolRefs.some((ref) => !this.#tools.has(ref))) throw new Error('UNKNOWN_SKILL_TOOL');
    this.#skills.set(skill.id, skill);
  }

  getTool(id: string): ToolDefinition | undefined { return this.#tools.get(id); }
  getSkill(id: string): SkillDefinition | undefined { return this.#skills.get(id); }
}

export interface ToolEffectTelemetryRecorder {
  record(
    name: 'sage_tool_effect_unknown_total',
    value: number,
    labels: { readonly component: 'tool-runtime'; readonly outcome: 'unknown'; readonly duplicate: boolean }
  ): void;
}

export interface ToolPipelineOptions {
  readonly registry: ToolRegistry;
  readonly eventRecorder: ToolEventRecorder;
  readonly authorizer?: ToolAuthorizer;
  readonly productionAuthorizer?: ProductionAuthorizationPort;
  readonly consumptionLedger?: ProductionConsumptionLedgerPort;
  readonly credentialProvider?: CredentialProvider;
  readonly artifactAdapter?: ArtifactAdapter;
  readonly idempotencyStore?: IdempotencyStore;
  readonly effectLedger?: ToolEffectLedgerPort;
  readonly productionExecutor?: ProductionToolExecutorPort;
  readonly telemetry: ToolEffectTelemetryRecorder;
  readonly inlineResultLimit?: number;
  readonly knownSecrets?: readonly string[];
  readonly idempotencyPollMs?: number;
}

interface ExecutionOutcome {
  readonly result: ToolResult;
  readonly effectMayHaveOccurred: boolean;
}

const effectUnknown = (): ToolResult => ({ status: 'effect_unknown', code: 'EFFECT_UNKNOWN', retryable: false });
const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const isToolResult = (value: unknown): value is ToolResult => {
  if (!value || typeof value !== 'object' || !('status' in value)) return false;
  const status = (value as { status: unknown }).status;
  return status === 'succeeded' || status === 'denied' || status === 'invalid' || status === 'failed' || status === 'effect_unknown';
};

interface ProductionAuthorizationSession {
  readonly receipt: AuthorizationReceipt;
  readonly reservation: UsageReservationV1;
}

export class ToolPipeline {
  readonly #inlineResultLimit: number;
  readonly #pollMs: number;
  constructor(private readonly options: ToolPipelineOptions) {
    this.#inlineResultLimit = options.inlineResultLimit ?? 8_192;
    this.#pollMs = options.idempotencyPollMs ?? 2;
  }

  async call(call: ToolCall): Promise<ToolResult> {
    try { assertToolCorrelation(call.correlation); }
    catch { return { status: 'invalid', code: 'TOOL_CORRELATION_INVALID', retryable: false }; }

    const tool = this.options.registry.getTool(call.toolId);
    if (!tool) return this.#record(call, { status: 'denied', code: 'TOOL_NOT_REGISTERED', retryable: false }, false);
    if (!Value.Check(tool.inputSchema, call.input)) {
      return this.#record(call, { status: 'invalid', code: 'TOOL_INPUT_INVALID', retryable: false }, false);
    }
    if (call.environment === 'production' && tool.access === 'write' && !this.options.effectLedger) {
      return this.#record(call, { status: 'denied', code: 'EFFECT_LEDGER_REQUIRED', retryable: false }, false);
    }
    if (call.environment === 'production' && (!this.options.productionExecutor || !tool.production)) {
      return this.#record(call, { status: 'denied', code: 'SANDBOX_UNAVAILABLE', retryable: false }, false);
    }

    let productionSession: ProductionAuthorizationSession | undefined;
    if (call.environment === 'production') {
      const authorized = await this.#authorizeProduction(tool, call);
      if (isToolResult(authorized)) return this.#record(call, authorized, false);
      productionSession = authorized;
    } else {
      const authorization = await this.#authorize(tool, call);
      if (authorization !== undefined) return this.#record(call, authorization, false);
    }

    if (tool.access === 'read') {
      const outcome = await this.#execute(tool, call);
      if (productionSession) await this.#releaseProductionReservation(productionSession.reservation, 'read_completed');
      return this.#record(call, outcome.result, false);
    }

    if (this.options.effectLedger) {
      if (!call.effectIdentity) {
        if (productionSession) await this.#releaseProductionReservation(productionSession.reservation, 'effect_identity_missing');
        return this.#record(call, { status: 'denied', code: 'EFFECT_IDENTITY_REQUIRED', retryable: false }, false);
      }
      return this.#callWithEffectLedger(tool, call, productionSession);
    }
    if (!call.idempotencyKey) return this.#record(call, { status: 'denied', code: 'IDEMPOTENCY_KEY_REQUIRED', retryable: false }, false);
    try { assertNoSensitiveData(call.idempotencyKey, this.options.knownSecrets); }
    catch { return this.#record(call, { status: 'denied', code: 'IDEMPOTENCY_KEY_INVALID', retryable: false }, false); }
    if (!this.options.idempotencyStore) {
      return this.#record(call, { status: 'denied', code: 'IDEMPOTENCY_STORE_UNAVAILABLE', retryable: true }, false);
    }

    const effectKey = createHash('sha256').update(`${call.tenantId}\0${tool.id}\0${call.idempotencyKey}`).digest('hex');
    const ownerToken = randomUUID();
    let claim;
    try {
      claim = await this.options.idempotencyStore.claim(effectKey, ownerToken, new Date(Date.now() + tool.timeoutMs + 5_000).toISOString());
    } catch {
      return this.#record(call, { status: 'denied', code: 'IDEMPOTENCY_STORE_UNAVAILABLE', retryable: true }, false);
    }

    if (claim.status === 'completed') return this.#recordDuplicate(call, claim.result);
    if (claim.status === 'in_progress') {
      const completed = await this.#waitForCompletion(effectKey, tool.timeoutMs + 1_000);
      if (completed !== undefined) return this.#recordDuplicate(call, completed);
      return this.#record(call, { status: 'failed', code: 'IDEMPOTENCY_IN_PROGRESS', retryable: true }, false);
    }

    const outcome = await this.#execute(tool, call);
    if (!outcome.effectMayHaveOccurred) {
      try { await this.options.idempotencyStore.release(effectKey, ownerToken); }
      catch { return this.#record(call, { status: 'failed', code: 'IDEMPOTENCY_STORE_UNAVAILABLE', retryable: true }, false); }
      return this.#record(call, outcome.result, false);
    }

    try { await this.options.idempotencyStore.complete(effectKey, ownerToken, outcome.result); }
    catch { return this.#record(call, effectUnknown(), true); }
    return this.#record(call, outcome.result, true);
  }

  async #callWithEffectLedger(tool: ToolDefinition, call: ToolCall, productionSession?: ProductionAuthorizationSession): Promise<ToolResult> {
    const binding = call.effectIdentity!;
    let canonicalInputDigest: `sha256:${string}`;
    try { canonicalInputDigest = `sha256:${createHash('sha256').update(canonicalToolJson(call.input)).digest('hex')}`; }
    catch {
      if (productionSession) await this.#releaseProductionReservation(productionSession.reservation, 'effect_identity_invalid');
      return this.#record(call, { status: 'denied', code: 'EFFECT_IDENTITY_INVALID', retryable: false }, false);
    }
    const expectedAction = `sha256:${createHash('sha256').update(canonicalToolJson([call.tenantId, binding.taskId, binding.attemptCompatibleActionKey, binding.toolVersion, canonicalInputDigest])).digest('hex')}`;
    if (binding.toolVersion !== tool.version || binding.canonicalInputDigest !== canonicalInputDigest || binding.semanticActionId !== expectedAction) {
      if (productionSession) await this.#releaseProductionReservation(productionSession.reservation, 'effect_identity_invalid');
      return this.#record(call, { status: 'denied', code: 'EFFECT_IDENTITY_INVALID', retryable: false }, false);
    }
    const claim = {
      schemaVersion: '1' as const, tenantId: call.tenantId, semanticActionId: binding.semanticActionId,
      taskId: binding.taskId, attemptCompatibleActionKey: binding.attemptCompatibleActionKey,
      toolRef: tool.id, toolVersion: binding.toolVersion, providerRef: binding.providerRef,
      providerBuildDigest: binding.providerBuildDigest, canonicalInputDigest: binding.canonicalInputDigest,
      invocationId: binding.invocationId, leaseOwner: binding.executorRef,
      leaseExpiresAt: new Date(Date.now() + tool.timeoutMs + 5_000).toISOString()
    };
    let authority;
    try { authority = await this.options.effectLedger!.claim(claim); }
    catch {
      if (productionSession) await this.#releaseProductionReservation(productionSession.reservation, 'effect_claim_unavailable');
      return this.#record(call, { status: 'denied', code: 'EFFECT_LEDGER_UNAVAILABLE', retryable: true }, false);
    }
    if (authority.status === 'conflict' || authority.status === 'in_progress') {
      if (productionSession) await this.#releaseProductionReservation(productionSession.reservation, `effect_${authority.status}`);
      return this.#record(call, authority.status === 'conflict'
        ? { status: 'denied', code: 'EFFECT_CONFLICT', retryable: false }
        : { status: 'denied', code: 'EFFECT_IN_PROGRESS', retryable: true }, false);
    }
    if (authority.status === 'unknown' || authority.status === 'replay') {
      if (productionSession) await this.#releaseProductionReservation(productionSession.reservation, `effect_${authority.status}`);
      const replayed = this.#resultFromEffectReceipt(authority.receipt, true);
      return this.#record(call, replayed ?? { status: 'failed', code: 'EFFECT_RECEIPT_INVALID', retryable: false }, false);
    }
    const outcome = await this.#execute(tool, call);
    if (!outcome.effectMayHaveOccurred) {
      if (productionSession) await this.#releaseProductionReservation(productionSession.reservation, 'effect_not_executed');
      return this.#record(call, outcome.result, false);
    }
    const committedAt = new Date().toISOString();
    const outcomeDigest = `sha256:${createHash('sha256').update(canonicalToolJson(outcome.result)).digest('hex')}`;
    const receiptBase = {
      schemaVersion: '1' as const,
      receiptRef: `effect-receipt://${binding.semanticActionId.slice('sha256:'.length)}`,
      tenantId: call.tenantId,
      semanticActionId: binding.semanticActionId,
      canonicalInputDigest: binding.canonicalInputDigest,
      toolVersion: binding.toolVersion,
      providerBuildDigest: binding.providerBuildDigest,
      fenceEpoch: authority.fenceEpoch,
      outcomeDigest,
      normalizedResult: structuredClone(outcome.result),
      committedAt
    };
    const state = outcome.result.status === 'effect_unknown' ? 'EFFECT_UNKNOWN' as const : 'COMMITTED' as const;
    const receiptDigest = `sha256:${createHash('sha256').update(canonicalToolJson({ ...receiptBase, state })).digest('hex')}`;
    const proposedReceipt = Object.freeze({ ...receiptBase, receiptDigest, state });
    try {
      if (state === 'EFFECT_UNKNOWN') {
        const stored = await this.options.effectLedger!.markUnknown({ claim, fenceEpoch: authority.fenceEpoch, receipt: proposedReceipt });
        return this.#record(call, this.#resultFromEffectReceipt(stored, false)
          ?? { status: 'effect_unknown', code: 'EFFECT_UNKNOWN', retryable: false, effectReceiptRef: stored.receiptRef }, true);
      }
      const committed = await this.options.effectLedger!.commit({ claim, fenceEpoch: authority.fenceEpoch, receipt: proposedReceipt });
      if (committed.status === 'conflict') return this.#record(call, { status: 'effect_unknown', code: 'EFFECT_UNKNOWN', retryable: false }, true);
      if (productionSession) await this.#releaseProductionReservation(productionSession.reservation, 'effect_committed');
      return this.#record(call, this.#resultFromEffectReceipt(committed.receipt, committed.status === 'existing')
        ?? { status: 'failed', code: 'EFFECT_RECEIPT_INVALID', retryable: false }, true);
    } catch {
      return this.#record(call, { status: 'effect_unknown', code: 'EFFECT_UNKNOWN', retryable: false }, true);
    }
  }

  #resultFromEffectReceipt(receipt: { readonly receiptRef: string; readonly normalizedResult: unknown }, duplicate: boolean): ToolResult | undefined {
    if (!isToolResult(receipt.normalizedResult)) return undefined;
    const result = structuredClone(receipt.normalizedResult);
    if ('effectReceiptRef' in result && result.effectReceiptRef !== undefined && result.effectReceiptRef !== receipt.receiptRef) return undefined;
    return { ...result, effectReceiptRef: receipt.receiptRef, ...(duplicate ? { duplicate: true } : {}) } as ToolResult;
  }

  async #recordDuplicate(call: ToolCall, stored: unknown): Promise<ToolResult> {
    if (!isToolResult(stored)) return this.#record(call, { status: 'failed', code: 'IDEMPOTENCY_RESULT_INVALID', retryable: false }, false);
    try { assertNoSensitiveData(stored, this.options.knownSecrets); }
    catch { return this.#record(call, { status: 'failed', code: 'IDEMPOTENCY_RESULT_INVALID', retryable: false }, false); }
    return this.#record(call, { ...stored, duplicate: true } as ToolResult, false);
  }

  async #waitForCompletion(key: string, timeoutMs: number): Promise<unknown | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const state = await this.options.idempotencyStore?.get(key);
        if (state?.status === 'completed') return state.result;
      } catch { return undefined; }
      await sleep(this.#pollMs);
    }
    return undefined;
  }

  async #authorizeProduction(tool: ToolDefinition, call: ToolCall): Promise<ProductionAuthorizationSession | ToolResult> {
    const authorizer = this.options.productionAuthorizer;
    const ledger = this.options.consumptionLedger;
    const authority = call.productionAuthority;
    const binding = call.effectIdentity;
    if (!authorizer || !ledger || !authority || !binding) return { status: 'denied', code: 'PRODUCTION_AUTHORIZATION_REQUIRED', retryable: false };
    let canonicalInputDigest: `sha256:${string}`;
    try { canonicalInputDigest = `sha256:${createHash('sha256').update(canonicalToolJson(call.input)).digest('hex')}`; }
    catch { return { status: 'denied', code: 'EFFECT_IDENTITY_INVALID', retryable: false }; }
    const expectedAction = `sha256:${createHash('sha256').update(canonicalToolJson([call.tenantId, binding.taskId, binding.attemptCompatibleActionKey, binding.toolVersion, canonicalInputDigest])).digest('hex')}`;
    if (binding.toolVersion !== tool.version || binding.canonicalInputDigest !== canonicalInputDigest || binding.semanticActionId !== expectedAction
      || binding.providerRef.length === 0 || !/^sha256:[a-f0-9]{64}$/.test(binding.providerBuildDigest)) {
      return { status: 'denied', code: 'EFFECT_IDENTITY_INVALID', retryable: false };
    }
    let balance: Awaited<ReturnType<ProductionConsumptionLedgerPort['getAuthoritativeBalance']>>;
    try { balance = await ledger.getAuthoritativeBalance({ tenantId: call.tenantId, accountRef: authority.accountRef }); }
    catch { return { status: 'denied', code: 'LEDGER_UNAVAILABLE', retryable: true }; }
    const now = new Date().toISOString();
    let receipt: AuthorizationReceipt;
    try {
      receipt = await authorizer.authorize({
        tenantId: call.tenantId, principalRef: authority.principalRef, specRef: authority.specRef, grantRef: authority.grantRef,
        ...(authority.approvalRef === undefined ? {} : { approvalRef: authority.approvalRef }),
        ...(authority.releaseRef === undefined ? {} : { releaseRef: authority.releaseRef }),
        ...(authority.modelRouteRef === undefined ? {} : { modelRouteRef: authority.modelRouteRef }),
        toolRef: tool.id, toolVersion: tool.version, providerRef: binding.providerRef, providerBuildDigest: binding.providerBuildDigest,
        canonicalInputDigest, semanticActionId: binding.semanticActionId, access: tool.access, risk: tool.risk,
        resourceScopes: authority.resourceScopes, environment: 'production', requestedCount: authority.requestedCount,
        requestedCost: authority.requestedCost, ledgerRevision: balance.revision, ledgerAvailable: true, now
      });
    } catch { return { status: 'denied', code: 'POLICY_UNAVAILABLE', retryable: true }; }
    if (!Value.Check(AuthorizationReceiptSchema, receipt)
      || receipt.tenantId !== call.tenantId || receipt.principalRef !== authority.principalRef || receipt.specRef !== authority.specRef
      || receipt.grantRef !== authority.grantRef || receipt.toolRef !== tool.id || receipt.providerRef !== binding.providerRef
      || receipt.semanticActionId !== binding.semanticActionId || receipt.ledgerRevision !== balance.revision) {
      return { status: 'denied', code: 'AUTHORIZATION_RECEIPT_INVALID', retryable: false };
    }
    if (receipt.decision !== 'ALLOW') return { status: 'denied', code: receipt.reasonCode, retryable: false };
    try {
      const reservation = await ledger.reserve({
        schemaVersion: '1', tenantId: call.tenantId, accountRef: authority.accountRef,
        invocationId: `${binding.invocationId}:${binding.semanticActionId}`, ownerRef: authority.principalRef,
        taskId: binding.taskId, runId: call.correlation.run_id, attemptId: String(call.correlation.attempt),
        specRef: authority.specRef, upperBound: authority.upperBound,
        leaseExpiresAt: new Date(Date.now() + tool.timeoutMs + 5_000).toISOString()
      });
      if (reservation.state !== 'RESERVED' || reservation.tenantId !== call.tenantId || reservation.accountRef !== authority.accountRef) {
        return { status: 'denied', code: 'LEDGER_UNAVAILABLE', retryable: true };
      }
      return { receipt: Object.freeze(structuredClone(receipt)), reservation: Object.freeze(structuredClone(reservation)) };
    } catch { return { status: 'denied', code: 'LEDGER_UNAVAILABLE', retryable: true }; }
  }

  async #releaseProductionReservation(reservation: UsageReservationV1, reason: string): Promise<void> {
    const result = await this.options.consumptionLedger!.release({ reservation, reason });
    if (result === 'conflict') throw new Error('USAGE_RELEASE_CONFLICT');
  }

  async #authorize(tool: ToolDefinition, call: ToolCall): Promise<ToolResult | undefined> {
    if (!this.options.authorizer) {
      return tool.defaultAllowlisted && tool.access === 'read' && tool.risk === 'low'
        ? undefined
        : { status: 'denied', code: 'AUTHORIZATION_NOT_CONFIGURED', retryable: false };
    }
    try {
      const decision = await this.options.authorizer.authorize({
        toolId: tool.id, access: tool.access, risk: tool.risk, tenantId: call.tenantId, input: call.input
      });
      return decision.allowed ? undefined : { status: 'denied', code: 'AUTHORIZATION_DENIED', retryable: false };
    } catch {
      return { status: 'denied', code: 'POLICY_UNAVAILABLE', retryable: true };
    }
  }

  async #execute(tool: ToolDefinition, call: ToolCall): Promise<ExecutionOutcome> {
    let credential: Uint8Array | undefined;
    const resolvedSecrets = [...(this.options.knownSecrets ?? [])];
    if (tool.requiresCredential) {
      if (!call.secret_ref || !tool.credentialScope || !this.options.credentialProvider) {
        return { result: { status: 'denied', code: 'CREDENTIAL_UNAVAILABLE', retryable: true }, effectMayHaveOccurred: false };
      }
      try {
        credential = (await this.options.credentialProvider.resolveCredential({
          secretRef: call.secret_ref,
          ...(call.connection_ref === undefined ? {} : { connectionRef: call.connection_ref }),
          tenantId: call.tenantId,
          environment: call.environment,
          purpose: tool.id,
          scope: tool.credentialScope
        })).value;
        const decoded = new TextDecoder().decode(credential);
        if (decoded.length > 0) resolvedSecrets.push(decoded);
      } catch {
        return { result: { status: 'denied', code: 'CREDENTIAL_UNAVAILABLE', retryable: true }, effectMayHaveOccurred: false };
      }
    }

    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ToolExecutionError('TOOL_TIMEOUT', 'Tool execution timed out', tool.access === 'write' ? 'unknown' : 'none', false));
        }, tool.timeoutMs);
      });
      const execution = call.environment === 'production'
        ? this.options.productionExecutor!.execute({
          executableRef: tool.production!.executableRef,
          input: call.input,
          egressUrls: tool.production!.egressUrls?.(call.input) ?? [],
          profile: productionSandboxProfile({ network: tool.production!.network, timeoutMs: tool.timeoutMs, outputBytes: this.#inlineResultLimit }),
          signal: controller.signal
        })
        : tool.execute(call.input, {
          tenantId: call.tenantId,
          environment: call.environment,
          correlation: call.correlation,
          ...(call.idempotencyKey === undefined ? {} : { idempotencyKey: call.idempotencyKey }),
          ...(credential === undefined ? {} : { credential }),
          signal: controller.signal
        });
      const output = await Promise.race([execution, timeout]);

      try { assertNoSensitiveData(output, resolvedSecrets); }
      catch {
        return {
          result: tool.access === 'write' ? effectUnknown() : { status: 'denied', code: 'SENSITIVE_TOOL_OUTPUT', retryable: false },
          effectMayHaveOccurred: tool.access === 'write'
        };
      }

      const normalized = await this.#normalizeOutput(tool, call, output);
      if (tool.access === 'write' && normalized.status === 'failed') {
        return { result: effectUnknown(), effectMayHaveOccurred: true };
      }
      return { result: normalized, effectMayHaveOccurred: tool.access === 'write' };
    } catch (cause) {
      const mayHaveOccurred = tool.access === 'write' && (!(cause instanceof ToolExecutionError) || cause.commit !== 'none');
      if (mayHaveOccurred) return { result: effectUnknown(), effectMayHaveOccurred: true };
      const error = cause instanceof ToolExecutionError
        ? { status: 'failed' as const, code: cause.code, retryable: cause.retryable }
        : { status: 'failed' as const, code: 'TOOL_EXECUTION_FAILED', retryable: false };
      return { result: error, effectMayHaveOccurred: false };
    } finally {
      if (timer) clearTimeout(timer);
      credential?.fill(0);
    }
  }

  async #normalizeOutput(tool: ToolDefinition, call: ToolCall, output: unknown): Promise<ToolResult> {
    const serialized = JSON.stringify(output) ?? 'null';
    const encoded = new TextEncoder().encode(serialized);
    if (!tool.restrictedOutput && encoded.byteLength <= this.#inlineResultLimit) return { status: 'succeeded', output };
    if (!this.options.artifactAdapter) return { status: 'failed', code: 'ARTIFACT_BACKEND_UNAVAILABLE', retryable: true };
    try {
      const artifact = await this.options.artifactAdapter.put({ tenantId: call.tenantId, mediaType: 'application/json', bytes: encoded });
      return { status: 'succeeded', artifact_ref: artifact.artifactRef as ArtifactRef };
    } catch {
      return { status: 'failed', code: 'ARTIFACT_BACKEND_UNAVAILABLE', retryable: true };
    }
  }

  async #record(call: ToolCall, result: ToolResult, effectMayHaveOccurred: boolean): Promise<ToolResult> {
    if (result.status === 'effect_unknown') {
      try {
        this.options.telemetry?.record(
          'sage_tool_effect_unknown_total',
          1,
          { component: 'tool-runtime', outcome: 'unknown', duplicate: result.duplicate === true }
        );
      } catch { /* Telemetry cannot change Tool effect semantics. */ }
    }
    const event: ToolEvent = {
      type: result.status === 'succeeded' ? 'tool.completed' : result.status === 'effect_unknown' ? 'tool.effect_unknown' : result.status === 'denied' ? 'tool.denied' : 'tool.failed',
      toolId: call.toolId,
      status: result.status,
      correlation: call.correlation,
      occurredAt: new Date().toISOString(),
      ...(call.idempotencyKey === undefined ? {} : { idempotencyKey: call.idempotencyKey }),
      ...('artifact_ref' in result && result.artifact_ref !== undefined ? { artifact_ref: result.artifact_ref } : {}),
      ...('code' in result ? { code: result.code } : {})
    };
    try {
      await this.options.eventRecorder.record(event);
      return result;
    } catch {
      return effectMayHaveOccurred
        ? { ...effectUnknown(), ...('effectReceiptRef' in result && result.effectReceiptRef !== undefined
          ? { effectReceiptRef: result.effectReceiptRef }
          : {}) }
        : { status: 'failed', code: 'EVENT_RECORDING_UNAVAILABLE', retryable: true };
    }
  }
}

/**
 * Canonical Capability adapter for the existing secure ToolPipeline. Engine and
 * Host code must use this adapter; they must not call ToolPipeline directly.
 */
export class ToolPipelineCapabilityBroker implements CapabilityBrokerPort {
  readonly #pipeline: ToolPipeline;
  readonly #descriptors: readonly (CapabilityDescriptor & { readonly toolVersion?: string; readonly providerBuildDigest?: `sha256:${string}` })[];
  readonly #environment: Environment;
  readonly #productionAuthorityFor: ((request: CapabilityRequest, descriptor: CapabilityDescriptor, binding: NonNullable<ToolCall['effectIdentity']>) => NonNullable<ToolCall['productionAuthority']>) | undefined;

  constructor(input: {
    readonly pipeline: ToolPipeline;
    readonly descriptors: readonly (CapabilityDescriptor & { readonly toolVersion?: string; readonly providerBuildDigest?: `sha256:${string}` })[];
    readonly environment: Environment;
    readonly productionAuthorityFor?: (request: CapabilityRequest, descriptor: CapabilityDescriptor, binding: NonNullable<ToolCall['effectIdentity']>) => NonNullable<ToolCall['productionAuthority']>;
  }) {
    this.#pipeline = input.pipeline;
    this.#descriptors = input.descriptors.map((descriptor) => ({ ...descriptor }));
    this.#environment = input.environment;
    this.#productionAuthorityFor = input.productionAuthorityFor;
    if (input.environment === 'production' && input.productionAuthorityFor === undefined) throw new Error('PRODUCTION_AUTHORITY_MAPPING_REQUIRED');
  }

  async describe(input: { readonly identity: RuntimeIdentity; readonly capabilityGrantRef: string }): Promise<readonly CapabilityDescriptor[]> {
    void input;
    return this.#descriptors.map((descriptor) => ({ ...descriptor }));
  }

  async invoke(request: CapabilityRequest): Promise<CapabilityObservation> {
    if (request.signal.aborted) return { status: 'denied', code: 'CAPABILITY_CANCELLED' };
    const descriptor = this.#descriptors.find((candidate) => candidate.toolRef === request.toolRef && candidate.providerRef === request.providerRef && candidate.schemaVersion === request.schemaVersion);
    if (descriptor === undefined) return { status: 'denied', code: 'CAPABILITY_NOT_GRANTED' };
    let productionBindings: { readonly effectIdentity: NonNullable<ToolCall['effectIdentity']>; readonly productionAuthority: NonNullable<ToolCall['productionAuthority']> } | undefined;
    if (this.#environment === 'production') {
      if (descriptor.toolVersion === undefined || descriptor.providerBuildDigest === undefined || this.#productionAuthorityFor === undefined) {
        return { status: 'denied', code: 'PRODUCTION_AUTHORITY_MAPPING_REQUIRED' };
      }
      const canonicalInputDigest = `sha256:${createHash('sha256').update(canonicalToolJson(request.input)).digest('hex')}` as const;
      const semanticActionId = `sha256:${createHash('sha256').update(canonicalToolJson([request.identity.tenantId, request.identity.taskId, request.actionId, descriptor.toolVersion, canonicalInputDigest])).digest('hex')}` as const;
      const effectIdentity = {
        semanticActionId, taskId: request.identity.taskId, attemptCompatibleActionKey: request.actionId,
        toolVersion: descriptor.toolVersion, providerRef: descriptor.providerRef,
        providerBuildDigest: descriptor.providerBuildDigest, canonicalInputDigest,
        invocationId: request.identity.invocationId, executorRef: request.identity.principalRef
      };
      productionBindings = { effectIdentity, productionAuthority: this.#productionAuthorityFor(request, descriptor, effectIdentity) };
    }
    const result = await this.#pipeline.call({
      toolId: descriptor.toolRef,
      input: request.input,
      tenantId: request.identity.tenantId,
      environment: this.#environment,
      correlation: {
        run_id: request.identity.runId,
        task_id: request.identity.taskId,
        workflow_id: request.identity.runId,
        target_id: descriptor.providerRef,
        attempt: 1,
        tool_call_id: request.actionId
      },
      idempotencyKey: request.actionId,
      ...(productionBindings ?? {})
    });
    if (result.status === 'effect_unknown') return {
      status: 'effect_unknown', code: 'EFFECT_UNKNOWN', normalizedResult: structuredClone(result),
      ...(result.effectReceiptRef === undefined ? {} : { effectReceiptRef: result.effectReceiptRef })
    };
    if (result.status !== 'succeeded') return { status: 'denied', code: result.code };
    if (this.#environment === 'production' && descriptor.access === 'write' && result.effectReceiptRef === undefined) {
      return { status: 'denied', code: 'EFFECT_RECEIPT_INVALID' };
    }
    const output = typeof result.output === 'object' && result.output !== null
      ? Object.fromEntries(Object.entries(result.output).filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) as BoundedRuntimePayload
      : {};
    return {
      status: 'committed', observationRef: `observation://tool/${request.actionId}`,
      ...(result.effectReceiptRef === undefined ? {} : { effectReceiptRef: result.effectReceiptRef }),
      output: result.artifact_ref === undefined ? output : { artifactRef: result.artifact_ref },
      normalizedResult: structuredClone(result)
    };
  }

  async health(): Promise<AdapterHealth> { return { healthy: true, checkedAt: new Date().toISOString() }; }
}

/**
 * MCP is intentionally represented as a discovery/schema/transport surface. It
 * has no execution method and cannot mutate the fixed grant descriptor set.
 */
export interface McpDiscoveryTransport {
  discover(input: { readonly identity: RuntimeIdentity; readonly signal: AbortSignal }): Promise<readonly CapabilityDescriptor[]>;
  getSchema(input: { readonly toolRef: string; readonly providerRef: string; readonly schemaVersion: string; readonly signal: AbortSignal }): Promise<Readonly<Record<string, unknown>> | undefined>;
  health(): Promise<AdapterHealth>;
}

/**
 * Narrows MCP discovery to the already-admitted provider/tool/schema snapshot,
 * then delegates execution to the canonical ToolPipeline Capability broker.
 * Discovery is never written back into grants and never executes a provider.
 */
export class McpCapabilityBrokerAdapter implements CapabilityBrokerPort {
  readonly #broker: CapabilityBrokerPort;
  readonly #transport: McpDiscoveryTransport;
  readonly #fixedDescriptors: readonly CapabilityDescriptor[];

  constructor(input: { readonly broker: CapabilityBrokerPort; readonly transport: McpDiscoveryTransport; readonly descriptors: readonly CapabilityDescriptor[] }) {
    this.#broker = input.broker;
    this.#transport = input.transport;
    this.#fixedDescriptors = input.descriptors.map((descriptor) => Object.freeze({ ...descriptor }));
  }

  async #intersection(input: { readonly identity: RuntimeIdentity; readonly capabilityGrantRef: string; readonly signal: AbortSignal }): Promise<readonly CapabilityDescriptor[] | undefined> {
    try {
      const [admitted, discovered] = await Promise.all([
        this.#broker.describe({ identity: input.identity, capabilityGrantRef: input.capabilityGrantRef }),
        this.#transport.discover({ identity: input.identity, signal: input.signal })
      ]);
      const fixed = this.#fixedDescriptors.filter((candidate) => admitted.some((item) => sameDescriptor(item, candidate)));
      return fixed.filter((candidate) => discovered.some((item) => sameDescriptor(item, candidate))).map((descriptor) => ({ ...descriptor }));
    } catch {
      return undefined;
    }
  }

  async describe(input: { readonly identity: RuntimeIdentity; readonly capabilityGrantRef: string }): Promise<readonly CapabilityDescriptor[]> {
    return await this.#intersection({ ...input, signal: new AbortController().signal }) ?? [];
  }

  async invoke(request: CapabilityRequest): Promise<CapabilityObservation> {
    if (request.signal.aborted) return { status: 'denied', code: 'CAPABILITY_CANCELLED' };
    const fixed = this.#fixedDescriptors.find((candidate) => sameDescriptor(candidate, { ...request, access: candidate.access }));
    if (fixed === undefined) return { status: 'denied', code: 'CAPABILITY_NOT_GRANTED' };
    const available = await this.#intersection({ identity: request.identity, capabilityGrantRef: request.capabilityGrantRef, signal: request.signal });
    if (available === undefined) return { status: 'denied', code: 'MCP_DISCOVERY_UNAVAILABLE' };
    if (!available.some((candidate) => sameDescriptor(candidate, fixed))) return { status: 'denied', code: 'MCP_DESCRIPTOR_NOT_DISCOVERED' };
    return await this.#broker.invoke(request);
  }

  async health(): Promise<AdapterHealth> {
    const [broker, transport] = await Promise.all([this.#broker.health(), this.#transport.health()]);
    return { healthy: broker.healthy && transport.healthy, checkedAt: new Date().toISOString() };
  }
}

const canonicalToolJson = (value: unknown): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('TOOL_INPUT_INVALID'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalToolJson).join(',')}]`;
  if (typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonicalToolJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  throw new Error('TOOL_INPUT_INVALID');
};

const sameDescriptor = (left: Pick<CapabilityDescriptor, 'toolRef' | 'providerRef' | 'schemaVersion' | 'access'>, right: Pick<CapabilityDescriptor, 'toolRef' | 'providerRef' | 'schemaVersion' | 'access'>): boolean =>
  left.toolRef === right.toolRef && left.providerRef === right.providerRef && left.schemaVersion === right.schemaVersion && left.access === right.access;

export * from './sandbox.js';
export * from './egress.js';
export * from './snapshot-egress.js';
