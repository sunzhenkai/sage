import { describe, expect, it, vi } from 'vitest';
import { Type } from 'typebox';
import { sha256Digest, type EffectReceipt } from '@sage/agent-contracts';
import {
  FailureInjectableArtifactAdapter,
  InMemoryCredentialProvider,
  InMemoryIdempotencyStore
} from '@sage/local-fakes';
import {
  ToolExecutionError,
  ToolPipeline,
  ToolPipelineCapabilityBroker,
  McpCapabilityBrokerAdapter,
  ToolRegistry,
  type ToolCall,
  type ToolDefinition,
  type ToolEvent,
  type ToolEventRecorder
} from './index.js';

const baseCall = (overrides: Partial<ToolCall> = {}): ToolCall => ({
  toolId: 'tool://read-metadata/v1', input: { path: 'package.json' }, tenantId: 'tenant-a', environment: 'local',
  correlation: { run_id: 'run-1', task_id: 'task-1', workflow_id: 'wf-1', target_id: 'local', attempt: 1, tool_call_id: 'call-1' },
  ...overrides
});

const tool = (overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
  id: 'tool://read-metadata/v1', version: '1', access: 'read', risk: 'low', defaultAllowlisted: true,
  timeoutMs: 100, restrictedOutput: false, requiresCredential: false,
  inputSchema: Type.Object({ path: Type.String() }, { additionalProperties: false }),
  async execute(input) { return { input, ok: true }; },
  ...overrides
});

const setup = (
  definition: ToolDefinition,
  options: Omit<ConstructorParameters<typeof ToolPipeline>[0], 'registry' | 'eventRecorder' | 'telemetry'> & { telemetry?: ConstructorParameters<typeof ToolPipeline>[0]['telemetry'] } = {},
  eventRecorder?: ToolEventRecorder
) => {
  const registry = new ToolRegistry();
  registry.registerTool(definition);
  const events: ToolEvent[] = [];
  const recorder = eventRecorder ?? { async record(event: ToolEvent) { events.push(event); } };
  const telemetry = options.telemetry ?? { record() {} };
  const pipeline = new ToolPipeline({ registry, eventRecorder: recorder, telemetry, idempotencyStore: new InMemoryIdempotencyStore(), ...options });
  return { pipeline, events, registry };
};

const allow = { async authorize() { return { allowed: true }; } };

const governanceDigest = `sha256:${'a'.repeat(64)}` as const;
const productionBindings = (definition: ToolDefinition, input: unknown, overrides: Partial<NonNullable<ToolCall['productionAuthority']>> = {}) => {
  const canonicalInputDigest = sha256Digest(input) as `sha256:${string}`;
  const semanticActionId = sha256Digest(['tenant-a', 'task-1', 'once', definition.version, canonicalInputDigest]) as `sha256:${string}`;
  return {
    effectIdentity: { semanticActionId, taskId: 'task-1', attemptCompatibleActionKey: 'once', toolVersion: definition.version, providerRef: 'provider://one', providerBuildDigest: governanceDigest, canonicalInputDigest, invocationId: 'invocation-1', executorRef: 'principal://executor' },
    productionAuthority: { principalRef: 'principal://executor', specRef: 'spec://one', grantRef: 'grant://one', approvalRef: 'approval://one', resourceScopes: ['resource://one'], accountRef: 'account://one', upperBound: { calls: 1 }, requestedCount: 1, requestedCost: 1, ...overrides }
  } satisfies Pick<ToolCall, 'effectIdentity' | 'productionAuthority'>;
};
const canonicalProductionAuthorizer = (calls?: unknown[]) => ({ async authorize(request: Parameters<NonNullable<ConstructorParameters<typeof ToolPipeline>[0]['productionAuthorizer']>['authorize']>[0]) {
  calls?.push(request);
  return { schemaVersion: '1' as const, receiptRef: 'authorization://one', decisionDigest: sha256Digest(request), tenantId: request.tenantId, principalRef: request.principalRef, specRef: request.specRef, grantRef: request.grantRef, toolRef: request.toolRef, providerRef: request.providerRef, semanticActionId: request.semanticActionId, decision: 'ALLOW' as const, reasonCode: 'AUTHORIZED' as const, policyVersion: 'p1', grantRevision: 1, revocationRevision: 1, approvalRevision: 1, ledgerRevision: request.ledgerRevision, evaluatedAt: request.now, freshnessDeadline: new Date(Date.now() + 60_000).toISOString() };
} });
const productionConsumptionLedger = (events?: string[]) => ({
  async getAuthoritativeBalance() { events?.push('balance'); return { available: { calls: 10 }, reserved: {}, revision: 7 }; },
  async reserve(input: Parameters<NonNullable<ConstructorParameters<typeof ToolPipeline>[0]['consumptionLedger']>['reserve']>[0]) { events?.push('reserve'); return { ...input, reservationRef: 'usage-reservation://one', state: 'RESERVED' as const, fenceEpoch: 1, createdAt: new Date().toISOString() }; },
  async release() { events?.push('release'); return 'released' as const; },
  async commit() { throw new Error('unused'); }, async getAuthoritativeBalanceUnused() { throw new Error('unused'); },
  async reconcile() { return []; }, async health() { return { healthy: true, checkedAt: new Date().toISOString() }; }
});
const unavailableRecorder: ToolEventRecorder = { async record() { throw new Error('event backend down'); } };

describe('secure Tool pipeline', () => {
  it('validates correlation and input before authorization/execution', async () => {
    let authorizations = 0;
    let executions = 0;
    const { pipeline, events } = setup(tool({ async execute() { executions += 1; return {}; } }), {
      authorizer: { async authorize() { authorizations += 1; return { allowed: true }; } }
    });
    const invalidCorrelation = await pipeline.call(baseCall({ correlation: { ...baseCall().correlation, password: 'bad' } as never }));
    expect(invalidCorrelation).toEqual({ status: 'invalid', code: 'TOOL_CORRELATION_INVALID', retryable: false });
    const result = await pipeline.call(baseCall({ input: { path: 42 } }));
    expect(result).toEqual({ status: 'invalid', code: 'TOOL_INPUT_INVALID', retryable: false });
    expect({ authorizations, executions }).toEqual({ authorizations: 0, executions: 0 });
    expect(events.map((event) => event.type)).toEqual(['tool.failed']);
  });

  it('allows only explicitly allowlisted low-risk read-only Tools without an authorizer', async () => {
    expect((await setup(tool()).pipeline.call(baseCall())).status).toBe('succeeded');
    const denied = setup(tool({ id: 'tool://list-private/v1', defaultAllowlisted: false }));
    expect(await denied.pipeline.call(baseCall({ toolId: 'tool://list-private/v1' }))).toMatchObject({ status: 'denied', code: 'AUTHORIZATION_NOT_CONFIGURED' });
    expect(() => setup(tool({ access: 'write', defaultAllowlisted: true }))).toThrow('UNSAFE_DEFAULT_ALLOWLIST');
  });

  it('fails closed for authorization denial and policy outage without executing', async () => {
    let executions = 0;
    const definition = tool({ async execute() { executions += 1; return {}; } });
    expect(await setup(definition, { authorizer: { async authorize() { return { allowed: false }; } } }).pipeline.call(baseCall()))
      .toMatchObject({ status: 'denied', code: 'AUTHORIZATION_DENIED' });
    expect(await setup(definition, { authorizer: { async authorize() { throw new Error('down'); } } }).pipeline.call(baseCall()))
      .toMatchObject({ status: 'denied', code: 'POLICY_UNAVAILABLE' });
    expect(executions).toBe(0);
  });

  it('atomically suppresses concurrent effects and shares completion across new Pipeline instances', async () => {
    let effects = 0;
    const definition = tool({
      id: 'tool://create-record/v1', access: 'write', risk: 'medium', defaultAllowlisted: false,
      async execute() { effects += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { recordId: effects }; }
    });
    const store = new InMemoryIdempotencyStore();
    const first = setup(definition, { authorizer: allow, idempotencyStore: store });
    const second = setup(definition, { authorizer: allow, idempotencyStore: store });
    const call = baseCall({ toolId: definition.id, idempotencyKey: 'idem-1' });
    const [one, two] = await Promise.all([first.pipeline.call(call), second.pipeline.call(call)]);
    expect([one, two].filter((result) => result.status === 'succeeded')).toHaveLength(2);
    expect([one, two].filter((result) => result.duplicate === true)).toHaveLength(1);
    expect(await setup(definition, { authorizer: allow, idempotencyStore: store }).pipeline.call(call))
      .toMatchObject({ status: 'succeeded', output: { recordId: 1 }, duplicate: true });
    expect(effects).toBe(1);
  });

  it('releases pre-commit claims so known-safe failures can execute again', async () => {
    let calls = 0;
    const definition = tool({
      id: 'tool://retryable-write/v1', access: 'write', risk: 'medium', defaultAllowlisted: false,
      async execute() { calls += 1; throw new ToolExecutionError('REMOTE_UNAVAILABLE', 'down', 'none', true); }
    });
    const store = new InMemoryIdempotencyStore();
    const call = baseCall({ toolId: definition.id, idempotencyKey: 'retry-me' });
    expect(await setup(definition, { authorizer: allow, idempotencyStore: store }).pipeline.call(call))
      .toMatchObject({ status: 'failed', code: 'REMOTE_UNAVAILABLE', retryable: true });
    expect(await setup(definition, { authorizer: allow, idempotencyStore: store }).pipeline.call(call))
      .toMatchObject({ status: 'failed', code: 'REMOTE_UNAVAILABLE', retryable: true });
    expect(calls).toBe(2);
  });

  it('normalizes timeout and uncertain write commit as non-retryable effect_unknown with full Tool correlation', async () => {
    const definition = tool({
      id: 'tool://uncertain-write/v1', access: 'write', risk: 'high', defaultAllowlisted: false, timeoutMs: 5,
      async execute() { await new Promise((resolve) => setTimeout(resolve, 30)); return { committed: true }; }
    });
    const metrics: unknown[] = [];
    const telemetry = { record(...args: unknown[]) { metrics.push(args); } };
    const { pipeline, events } = setup(definition, { authorizer: allow, telemetry });
    const call = baseCall({ toolId: definition.id, idempotencyKey: 'idem-unknown' });
    expect(await pipeline.call(call)).toEqual({ status: 'effect_unknown', code: 'EFFECT_UNKNOWN', retryable: false });
    expect(await pipeline.call(call)).toMatchObject({ status: 'effect_unknown', duplicate: true });
    expect(events[0]?.type).toBe('tool.effect_unknown');
    expect(metrics).toEqual([
      ['sage_tool_effect_unknown_total', 1, { component: 'tool-runtime', outcome: 'unknown', duplicate: false }],
      ['sage_tool_effect_unknown_total', 1, { component: 'tool-runtime', outcome: 'unknown', duplicate: true }]
    ]);
    const telemetryFailure = setup(definition, { authorizer: allow, telemetry: { record() { throw new Error('metrics down'); } } });
    expect(await telemetryFailure.pipeline.call(baseCall({ toolId: definition.id, idempotencyKey: 'idem-telemetry-down' })))
      .toMatchObject({ status: 'effect_unknown', retryable: false });
  });

  it('binds resolved credentials to execution scope and fails closed on outage', async () => {
    const credentials = new InMemoryCredentialProvider();
    credentials.set('secret://service/key', 'top-secret-value', {
      scope: 'records:read', connectionRef: 'connection://service', tenantId: 'tenant-a', environment: 'local', purpose: 'tool://read-metadata/v1'
    });
    let observed = '';
    const definition = tool({ requiresCredential: true, credentialScope: 'records:read', async execute(_input, context) {
      observed = new TextDecoder().decode(context.credential); return { ok: true };
    } });
    const configured = setup(definition, { credentialProvider: credentials });
    const call = baseCall({ secret_ref: 'secret://service/key', connection_ref: 'connection://service' });
    expect((await configured.pipeline.call(call)).status).toBe('succeeded');
    expect(observed).toBe('top-secret-value');
    credentials.failNext('resolve');
    expect(await configured.pipeline.call(call)).toMatchObject({ status: 'denied', code: 'CREDENTIAL_UNAVAILABLE' });
    expect(JSON.stringify(configured.events)).not.toContain('top-secret-value');
  });

  it('rejects resolved credentials, known secrets, sensitive keys, and restricted-result patterns before inline or Artifact writes', async () => {
    const credentials = new InMemoryCredentialProvider();
    credentials.set('secret://service/key', 'resolved-secret-12345', {
      scope: 'records:read', connectionRef: 'connection://service', tenantId: 'tenant-a', environment: 'local', purpose: 'tool://read-metadata/v1'
    });
    let artifactPuts = 0;
    const artifactAdapter = {
      async put() { artifactPuts += 1; throw new Error('must not write'); },
      async get() { return new Uint8Array(); }, async delete() {}, async health() { return { healthy: true, checkedAt: new Date().toISOString() }; }
    };
    const credentialOutput = tool({ requiresCredential: true, credentialScope: 'records:read', restrictedOutput: true,
      async execute(_input, context) { return { body: new TextDecoder().decode(context.credential) }; } });
    expect(await setup(credentialOutput, { credentialProvider: credentials, artifactAdapter }).pipeline.call(baseCall({
      secret_ref: 'secret://service/key', connection_ref: 'connection://service'
    }))).toEqual({ status: 'denied', code: 'SENSITIVE_TOOL_OUTPUT', retryable: false });
    expect(await setup(tool({ restrictedOutput: true, async execute() { return { body: 'configured-known-secret' }; } }), {
      artifactAdapter, knownSecrets: ['configured-known-secret']
    }).pipeline.call(baseCall())).toEqual({ status: 'denied', code: 'SENSITIVE_TOOL_OUTPUT', retryable: false });
    expect(await setup(tool({ restrictedOutput: true, async execute() { return { password: 'ordinary-looking' }; } }), { artifactAdapter }).pipeline.call(baseCall()))
      .toEqual({ status: 'denied', code: 'SENSITIVE_TOOL_OUTPUT', retryable: false });
    expect(await setup(tool({ restrictedOutput: true, async execute() { return { restricted_result: 'body' }; } }), { artifactAdapter }).pipeline.call(baseCall()))
      .toEqual({ status: 'denied', code: 'SENSITIVE_TOOL_OUTPUT', retryable: false });
    expect(artifactPuts).toBe(0);
  });

  it('returns effect_unknown for a write that executed before sensitive output was detected', async () => {
    const definition = tool({
      id: 'tool://sensitive-write/v1', access: 'write', risk: 'high', defaultAllowlisted: false, restrictedOutput: true,
      async execute() { return { access_token: 'token-abcdefghijkl' }; }
    });
    const artifacts = new FailureInjectableArtifactAdapter();
    const call = baseCall({ toolId: definition.id, idempotencyKey: 'sensitive-write' });
    expect(await setup(definition, { authorizer: allow, artifactAdapter: artifacts }).pipeline.call(call))
      .toEqual({ status: 'effect_unknown', code: 'EFFECT_UNKNOWN', retryable: false });
  });

  it('stores safe oversized/restricted output only as artifact_ref and never falls back inline', async () => {
    const artifacts = new FailureInjectableArtifactAdapter();
    const definition = tool({ restrictedOutput: true, async execute() { return { payload: 'private-body' }; } });
    const { pipeline, events } = setup(definition, { artifactAdapter: artifacts, inlineResultLimit: 8 });
    const result = await pipeline.call(baseCall());
    expect(result).toHaveProperty('artifact_ref');
    expect(result).not.toHaveProperty('output');
    expect(JSON.stringify(events)).not.toContain('private-body');
    artifacts.failNext('put');
    expect(await pipeline.call(baseCall())).toEqual({ status: 'failed', code: 'ARTIFACT_BACKEND_UNAVAILABLE', retryable: true });
  });

  it('does not retry a write whose effect completed before Artifact normalization failed', async () => {
    let effects = 0;
    const artifacts = new FailureInjectableArtifactAdapter();
    artifacts.failNext('put');
    const definition = tool({
      id: 'tool://write-restricted/v1', access: 'write', risk: 'high', defaultAllowlisted: false, restrictedOutput: true,
      async execute() { effects += 1; return { payload: 'committed-private-output' }; }
    });
    const { pipeline } = setup(definition, { artifactAdapter: artifacts, authorizer: allow });
    const call = baseCall({ toolId: definition.id, idempotencyKey: 'artifact-uncertain' });
    expect(await pipeline.call(call)).toEqual({ status: 'effect_unknown', code: 'EFFECT_UNKNOWN', retryable: false });
    expect(await pipeline.call(call)).toMatchObject({ status: 'effect_unknown', duplicate: true });
    expect(effects).toBe(1);
  });

  it('never maps validate/authorize/credential pre-execution recorder outages to effect_unknown', async () => {
    const invalid = setup(tool(), {}, unavailableRecorder);
    expect(await invalid.pipeline.call(baseCall({ input: { path: 1 }, idempotencyKey: 'unused' })))
      .toEqual({ status: 'failed', code: 'EVENT_RECORDING_UNAVAILABLE', retryable: true });

    const denied = setup(tool({ defaultAllowlisted: false }), {}, unavailableRecorder);
    expect(await denied.pipeline.call(baseCall()))
      .toEqual({ status: 'failed', code: 'EVENT_RECORDING_UNAVAILABLE', retryable: true });

    const credential = setup(tool({ requiresCredential: true, credentialScope: 'read' }), {}, unavailableRecorder);
    expect(await credential.pipeline.call(baseCall({ secret_ref: 'secret://missing' })))
      .toEqual({ status: 'failed', code: 'EVENT_RECORDING_UNAVAILABLE', retryable: true });
  });

  it('uses effect_unknown only when event recording fails after a write may have executed', async () => {
    const definition = tool({ id: 'tool://write/v1', access: 'write', risk: 'medium', defaultAllowlisted: false, async execute() { return { ok: true }; } });
    expect(await setup(definition, { authorizer: allow }, unavailableRecorder).pipeline.call(baseCall({ toolId: definition.id, idempotencyKey: 'write-event-outage' })))
      .toEqual({ status: 'effect_unknown', code: 'EFFECT_UNKNOWN', retryable: false });
  });

  it('adapts Capability calls through the secure ToolPipeline and preserves effect_unknown', async () => {
    const definition = tool({ id: 'tool://publish/v1', access: 'write', risk: 'medium', defaultAllowlisted: false, timeoutMs: 5, async execute() { await new Promise((resolve) => setTimeout(resolve, 20)); return { published: true }; } });
    const configured = setup(definition, { authorizer: allow });
    const broker = new ToolPipelineCapabilityBroker({ pipeline: configured.pipeline, environment: 'local', descriptors: [{ toolRef: definition.id, providerRef: 'provider://one', schemaVersion: '1', access: 'write' }] });
    const identity = { principalRef: 'principal://one', tenantId: 'tenant-a', taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1', invocationId: 'invocation-1', specDigest: 'sha256:' + 'a'.repeat(64) };
    const request = { identity, capabilityGrantRef: 'grant://one', toolRef: definition.id, providerRef: 'provider://one', schemaVersion: '1', input: { path: 'artifact://one' }, actionId: 'publish-1', signal: new AbortController().signal } as const;
    expect(await broker.describe({ identity, capabilityGrantRef: request.capabilityGrantRef })).toHaveLength(1);
    await expect(broker.invoke(request)).resolves.toMatchObject({ status: 'effect_unknown', code: 'EFFECT_UNKNOWN' });
    expect(configured.events.map((event) => event.type)).toContain('tool.effect_unknown');
  });

  it('rejects Capability descriptors not declared by the fixed adapter snapshot', async () => {
    const configured = setup(tool());
    const broker = new ToolPipelineCapabilityBroker({ pipeline: configured.pipeline, environment: 'local', descriptors: [{ toolRef: 'tool://other/v1', providerRef: 'provider://one', schemaVersion: '1', access: 'read' }] });
    const identity = { principalRef: 'principal://one', tenantId: 'tenant-a', taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1', invocationId: 'invocation-2', specDigest: 'sha256:' + 'a'.repeat(64) };
    await expect(broker.invoke({ identity, capabilityGrantRef: 'grant://one', toolRef: 'tool://read-metadata/v1', providerRef: 'provider://one', schemaVersion: '1', input: {}, actionId: 'read-1', signal: new AbortController().signal })).resolves.toEqual({ status: 'denied', code: 'CAPABILITY_NOT_GRANTED' });
  });

  it('intersects MCP discovery with the fixed grant and does not expose newly discovered Tools', async () => {
    const configured = setup(tool());
    const fixed = { toolRef: 'tool://read-metadata/v1', providerRef: 'provider://one', schemaVersion: '1', access: 'read' as const };
    const discovered = [fixed, { toolRef: 'tool://new-tool/v1', providerRef: 'provider://one', schemaVersion: '1', access: 'read' as const }];
    const transport = {
      async discover() { return discovered; },
      async getSchema() { return { type: 'object' }; },
      async health() { return { healthy: true, checkedAt: new Date().toISOString() }; }
    };
    const broker = new ToolPipelineCapabilityBroker({ pipeline: configured.pipeline, environment: 'local', descriptors: [fixed] });
    const adapter = new McpCapabilityBrokerAdapter({ broker, transport, descriptors: [fixed] });
    const identity = { principalRef: 'principal://one', tenantId: 'tenant-a', taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1', invocationId: 'invocation-mcp-1', specDigest: 'sha256:' + 'a'.repeat(64) };
    expect(await adapter.describe({ identity, capabilityGrantRef: 'grant://one' })).toEqual([fixed]);
    await expect(adapter.invoke({ identity, capabilityGrantRef: 'grant://one', ...fixed, input: { path: 'package.json' }, actionId: 'mcp-read-1', signal: new AbortController().signal })).resolves.toMatchObject({ status: 'committed' });
    await expect(adapter.invoke({ identity, capabilityGrantRef: 'grant://one', toolRef: 'tool://new-tool/v1', providerRef: 'provider://one', schemaVersion: '1', input: {}, actionId: 'mcp-new-1', signal: new AbortController().signal })).resolves.toEqual({ status: 'denied', code: 'CAPABILITY_NOT_GRANTED' });
  });

  it('rejects MCP same-name provider or schema drift without changing the admitted descriptor', async () => {
    const configured = setup(tool());
    const fixed = { toolRef: 'tool://read-metadata/v1', providerRef: 'provider://one', schemaVersion: '1', access: 'read' as const };
    let discovered = { ...fixed, providerRef: 'provider://other' };
    const transport = {
      async discover() { return [discovered]; },
      async getSchema() { return { type: 'object' }; },
      async health() { return { healthy: true, checkedAt: new Date().toISOString() }; }
    };
    const broker = new ToolPipelineCapabilityBroker({ pipeline: configured.pipeline, environment: 'local', descriptors: [fixed] });
    const adapter = new McpCapabilityBrokerAdapter({ broker, transport, descriptors: [fixed] });
    const identity = { principalRef: 'principal://one', tenantId: 'tenant-a', taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1', invocationId: 'invocation-mcp-2', specDigest: 'sha256:' + 'a'.repeat(64) };
    expect(await adapter.describe({ identity, capabilityGrantRef: 'grant://one' })).toEqual([]);
    await expect(adapter.invoke({ identity, capabilityGrantRef: 'grant://one', ...fixed, input: { path: 'package.json' }, actionId: 'mcp-drift-1', signal: new AbortController().signal })).resolves.toEqual({ status: 'denied', code: 'MCP_DESCRIPTOR_NOT_DISCOVERED' });
    discovered = { ...fixed, schemaVersion: '2' };
    expect(await adapter.describe({ identity, capabilityGrantRef: 'grant://one' })).toEqual([]);
    await expect(adapter.invoke({ identity, capabilityGrantRef: 'grant://one', ...fixed, input: { path: 'package.json' }, actionId: 'mcp-schema-drift-1', signal: new AbortController().signal })).resolves.toEqual({ status: 'denied', code: 'MCP_DESCRIPTOR_NOT_DISCOVERED' });
    expect(configured.events).toHaveLength(0);
  });

  it('fails closed when MCP discovery is unavailable', async () => {
    const configured = setup(tool());
    const fixed = { toolRef: 'tool://read-metadata/v1', providerRef: 'provider://one', schemaVersion: '1', access: 'read' as const };
    const transport = {
      async discover() { throw new Error('mcp unavailable'); },
      async getSchema() { return undefined; },
      async health() { return { healthy: false, checkedAt: new Date().toISOString() }; }
    };
    const broker = new ToolPipelineCapabilityBroker({ pipeline: configured.pipeline, environment: 'local', descriptors: [fixed] });
    const adapter = new McpCapabilityBrokerAdapter({ broker, transport, descriptors: [fixed] });
    const identity = { principalRef: 'principal://one', tenantId: 'tenant-a', taskId: 'task-1', runId: 'run-1', attemptId: 'attempt-1', invocationId: 'invocation-mcp-3', specDigest: 'sha256:' + 'a'.repeat(64) };
    await expect(adapter.invoke({ identity, capabilityGrantRef: 'grant://one', ...fixed, input: { path: 'package.json' }, actionId: 'mcp-down-1', signal: new AbortController().signal })).resolves.toEqual({ status: 'denied', code: 'MCP_DISCOVERY_UNAVAILABLE' });
    expect(configured.events).toHaveLength(0);
  });

  it('does not offer default Shell, browser, or untrusted-code Tools', () => {
    const registry = setup(tool()).registry;
    expect(registry.getTool('tool://shell/v1')).toBeUndefined();
    expect(registry.getTool('tool://browser/v1')).toBeUndefined();
    expect(registry.getTool('tool://execute-code/v1')).toBeUndefined();
  });
});


describe('production Tool enforcement', () => {
  it('denies a production write without Effect Ledger with zero authorization and provider calls', async () => {
    let authorizations = 0; let providerCalls = 0; let sandboxCalls = 0;
    const definition = tool({ id: 'tool://production-write/v1', access: 'write', risk: 'high', defaultAllowlisted: false, production: { executableRef: 'oci://trusted/write@sha256:abc', network: 'none' }, async execute() { providerCalls += 1; return {}; } });
    const { pipeline } = setup(definition, { authorizer: { async authorize() { authorizations += 1; return { allowed: true }; } }, productionExecutor: { execute: async () => { sandboxCalls += 1; return {}; }, health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) } });
    await expect(pipeline.call(baseCall({ toolId: definition.id, environment: 'production', idempotencyKey: 'legacy-must-not-run' }))).resolves.toEqual({ status: 'denied', code: 'EFFECT_LEDGER_REQUIRED', retryable: false });
    expect({ authorizations, providerCalls, sandboxCalls }).toEqual({ authorizations: 0, providerCalls: 0, sandboxCalls: 0 });
  });

  it('rejects a generic boolean production authorizer with zero budget, Effect, or provider calls', async () => {
    const genericAuthorize = vi.fn(async () => ({ allowed: true }));
    const claim = vi.fn();
    const sandbox = vi.fn();
    const definition = tool({ id: 'tool://production-write/v1', access: 'write', risk: 'high', defaultAllowlisted: false, production: { executableRef: 'oci://trusted/write', network: 'none' } });
    const { pipeline } = setup(definition, {
      authorizer: { authorize: genericAuthorize }, effectLedger: { claim } as never,
      productionExecutor: { execute: sandbox, health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) }
    });
    await expect(pipeline.call(baseCall({ toolId: definition.id, environment: 'production' }))).resolves.toEqual({ status: 'denied', code: 'PRODUCTION_AUTHORIZATION_REQUIRED', retryable: false });
    expect(genericAuthorize).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(sandbox).not.toHaveBeenCalled();
  });

  it('requires canonical ALLOW receipt and authoritative reservation before Effect claim, then replays exact receipt/result', async () => {
    const order: string[] = [];
    let storedReceipt: EffectReceipt | undefined;
    const claim = vi.fn(async () => {
      order.push('effect-claim');
      return storedReceipt ? { status: 'replay' as const, receipt: storedReceipt } : { status: 'claimed' as const, fenceEpoch: 9, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() };
    });
    const effectLedger = {
      claim,
      commit: vi.fn(async ({ receipt }: { receipt: EffectReceipt }) => { order.push('effect-commit'); storedReceipt = receipt; return { status: 'committed' as const, receipt }; }),
      markUnknown: async ({ receipt }: { receipt: EffectReceipt }) => receipt,
      resolve: async () => ({ status: 'denied' as const, code: 'unused' }), reconcile: async () => [], health: async () => ({ healthy: true, checkedAt: new Date().toISOString() })
    };
    let sandboxCalls = 0;
    const definition = tool({ id: 'tool://production-write/v1', access: 'write', risk: 'high', defaultAllowlisted: false, production: { executableRef: 'oci://trusted/write', network: 'none' } });
    const { pipeline } = setup(definition, {
      authorizer: { authorize: vi.fn(async () => ({ allowed: true })) },
      productionAuthorizer: { authorize: async request => { order.push('canonical-authorization'); return canonicalProductionAuthorizer().authorize(request); } },
      consumptionLedger: productionConsumptionLedger(order), effectLedger: effectLedger as never,
      productionExecutor: { execute: async () => { order.push('provider'); sandboxCalls += 1; return { nested: { provider: 'exact' }, sequence: sandboxCalls }; }, health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) }
    });
    const input = { path: 'invoice://one' };
    const call = baseCall({ toolId: definition.id, input, environment: 'production', ...productionBindings(definition, input) });
    const first = await pipeline.call(call);
    expect(first).toMatchObject({ status: 'succeeded', output: { nested: { provider: 'exact' }, sequence: 1 }, effectReceiptRef: storedReceipt?.receiptRef });
    expect(order.indexOf('canonical-authorization')).toBeLessThan(order.indexOf('reserve'));
    expect(order.indexOf('reserve')).toBeLessThan(order.indexOf('effect-claim'));
    expect(order.indexOf('effect-claim')).toBeLessThan(order.indexOf('provider'));
    const second = await pipeline.call(call);
    expect(second).toEqual({ ...(storedReceipt!.normalizedResult as object), effectReceiptRef: storedReceipt!.receiptRef, duplicate: true });
    expect(sandboxCalls).toBe(1);
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('preserves the committed Effect receipt ref when event recording fails after commit', async () => {
    let committedReceipt: EffectReceipt | undefined;
    const definition = tool({
      id: 'tool://production-write-recorder-outage/v1', access: 'write', risk: 'high', defaultAllowlisted: false,
      production: { executableRef: 'oci://trusted/write', network: 'none' }
    });
    const input = { path: 'invoice://recorder-outage' };
    const effectLedger = {
      claim: async () => ({ status: 'claimed' as const, fenceEpoch: 3, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }),
      commit: async ({ receipt }: { receipt: EffectReceipt }) => {
        committedReceipt = receipt;
        return { status: 'committed' as const, receipt };
      },
      markUnknown: async ({ receipt }: { receipt: EffectReceipt }) => receipt,
      resolve: async () => ({ status: 'denied' as const, code: 'unused' }),
      reconcile: async () => [],
      health: async () => ({ healthy: true, checkedAt: new Date().toISOString() })
    };
    const { pipeline } = setup(definition, {
      productionAuthorizer: canonicalProductionAuthorizer(),
      consumptionLedger: productionConsumptionLedger(),
      effectLedger: effectLedger as never,
      productionExecutor: {
        execute: async () => ({ nested: { committed: true } }),
        health: async () => ({ healthy: true, checkedAt: new Date().toISOString() })
      }
    }, unavailableRecorder);
    const result = await pipeline.call(baseCall({
      toolId: definition.id, input, environment: 'production', ...productionBindings(definition, input)
    }));
    expect(committedReceipt?.normalizedResult).toEqual({ status: 'succeeded', output: { nested: { committed: true } } });
    expect(result).toEqual({
      status: 'effect_unknown', code: 'EFFECT_UNKNOWN', retryable: false, effectReceiptRef: committedReceipt?.receiptRef
    });
  });

  it('routes production reads through canonical authorization, reservation, and mandatory sandbox', async () => {
    let inProcess = 0; let sandbox = 0;
    const definition = tool({ production: { executableRef: 'oci://trusted/read@sha256:abc', network: 'none' }, async execute() { inProcess += 1; return { bypass: true }; } });
    const input = { path: 'package.json' };
    const { pipeline } = setup(definition, {
      productionAuthorizer: canonicalProductionAuthorizer(), consumptionLedger: productionConsumptionLedger(),
      productionExecutor: { execute: async request => { sandbox += 1; expect(request.profile.readOnlyRootFilesystem).toBe(true); return { sandboxed: true }; }, health: async () => ({ healthy: true, checkedAt: new Date().toISOString() }) }
    });
    await expect(pipeline.call(baseCall({ input, environment: 'production', ...productionBindings(definition, input) }))).resolves.toMatchObject({ status: 'succeeded', output: { sandboxed: true } });
    expect({ inProcess, sandbox }).toEqual({ inProcess: 0, sandbox: 1 });
  });
});
