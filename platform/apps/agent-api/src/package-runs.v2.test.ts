import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { AuthenticatedPrincipal } from '@sage/app-contracts';
import { InMemoryAgentTaskSpecStore } from '@sage/local-fakes';
import type { ControlledEgressConnectorPort, EgressTransportResponse } from '@sage/tool-runtime';
import type { TaskPackageInputRecord, ProviderConnectionRecord, RunAgentSettingsRecord } from '@sage/task-domain';
import { registerPackageRunsRoutes, type PackageReleaseResolver, type RegisterPackageRunsRoutesOptions } from './runs-api.js';
import type { TaskControllerPort } from './task-api.js';
import type { TaskQueryResult } from '@sage/task-domain';

const operator: AuthenticatedPrincipal = { authenticationId: 'auth-op', principalId: 'op', tenantId: 'tenant-local', roles: ['task-operator'] };

class FakeConnector implements ControlledEgressConnectorPort {
  readonly requests: string[] = [];
  constructor(private readonly respond: (url: string) => EgressTransportResponse | Error) {}
  async request(input: { readonly url: string }): Promise<EgressTransportResponse> {
    this.requests.push(input.url);
    const outcome = this.respond(input.url);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
  async health(): Promise<{ readonly healthy: boolean; readonly checkedAt: string }> { return { healthy: true, checkedAt: new Date().toISOString() }; }
}

const textResponse = (status: number, body: string): EgressTransportResponse => ({
  status, headers: { 'content-type': 'application/json' }, body: new Uint8Array(Buffer.from(body))
});

const release = {
  schemaVersion: '1' as const,
  releaseRef: 'release://sha256:' + 'a'.repeat(64),
  releaseId: 'sha256:' + 'a'.repeat(64),
  packageRef: 'package://package-platform/demo-assistant',
  packageId: 'demo-assistant',
  packageVersion: '1.0.0',
  packageDigest: 'sha256:' + 'b'.repeat(64),
  contentDigest: 'sha256:' + 'c'.repeat(64),
  lockDigest: 'sha256:' + 'd'.repeat(64),
  ownerRef: 'owner://package-platform',
  compatibility: { kernelContractMajor: 1, engineIds: ['engine-local'], engineCompatibilityDigests: ['sha256:' + 'e'.repeat(64)] },
  provenance: {
    compilerRef: 'compiler://local', compilerDigest: 'sha256:' + 'f'.repeat(64), compilerBuild: 'local-dev',
    sourceDigest: 'sha256:' + 'b'.repeat(64), lockDigest: 'sha256:' + 'd'.repeat(64), sbomDigest: 'sha256:' + '1'.repeat(64),
    provenanceDigest: 'sha256:' + '2'.repeat(64), policyDigest: 'sha256:' + '3'.repeat(64), signatureDigest: 'sha256:' + '4'.repeat(64)
  },
  signatureRefs: ['signature://release/1'],
  attestationRefs: ['sbom://release/1', 'provenance://release/1', 'signature://release/1'],
  dependencyDigests: ['sha256:' + '5'.repeat(64)]
};

const assets = [
  { relativePath: 'prompts/system.md', kind: 'prompt', content: '你是演示助手。' },
  { relativePath: 'references/product.md', kind: 'reference', content: '# 产品说明' },
  { relativePath: 'output.schema.json', kind: 'output-schema', content: '{\n  "type": "object",\n  "required": ["overview"],\n  "properties": { "overview": { "type": "string" } }\n}\n' }
];

const v2Manifest = {
  id: 'demo-assistant', version: '1.0.0', entry: 'prompts/system.md',
  modelRoute: { provider: 'anthropic', model: 'claude-sonnet-4-5' }, skillRefs: [], capabilityRefs: [],
  inputs: [
    { name: 'window', type: 'enum', enum: [1, 7, 30], default: 7, required: false },
    { name: 'language', type: 'string', required: false }
  ],
  dataSources: [{ name: 'trending', ref: 'capability://web-snapshot-reader/v1', url: 'https://api.github.com/search/repositories', maxBytes: 4096, onFailure: 'fail' }],
  tasks: [
    { name: 'digest', entry: 'prompts/system.md', params: [{ name: 'window', from: { kind: 'input', input: 'window' } }], output: { schema: 'output.schema.json', files: ['report.md'] } },
    { name: 'summary', entry: 'prompts/system.md', params: [], output: {} }
  ]
};

interface Harness {
  inject(payload: unknown): Promise<{ statusCode: number; json(): Record<string, unknown> }>;
  // fastify inject 需要 InjectPayload；测试侧统一收窄为对象 payload。

  storedInputs: readonly TaskPackageInputRecord[];
}

interface HarnessSeeds {
  readonly connections?: ReadonlyArray<ProviderConnectionRecord>;
  /** null = 显式 unset（不落默认种子）。 */
  readonly settingsConnectionId?: string | null;
}

async function harness(manifest: Record<string, unknown>, connector?: ControlledEgressConnectorPort, seeds: HarnessSeeds = {}): Promise<Harness> {
  const resolver: PackageReleaseResolver = {
    async resolveRelease(_tenantId, releaseId) {
      if (releaseId !== 'a'.repeat(64)) return undefined;
      return { release: release as never, lockPayload: { manifest: manifest as never, assets } };
    }
  };
  const storedInputs: TaskPackageInputRecord[] = [];
  const taskStore = {
    async writePackageInput(record: TaskPackageInputRecord): Promise<{ status: 'stored' }> { storedInputs.push(record); return { status: 'stored' as const }; },
    async getPackageInput(): Promise<TaskPackageInputRecord | undefined> { return storedInputs[0]; }
  };
  const connections = new Map<string, ProviderConnectionRecord>();
  const seedEntries = seeds.connections ?? [{
    tenantId: 'tenant-local', id: 'conn-ok', name: 'ok', source: 'user', adapterKind: 'anthropic',
    baseUrl: 'https://api.example', modelId: 'm1', enabled: true, credentialPresent: true,
    createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z'
  }];
  for (const record of seedEntries) connections.set(`tenant-local/${record.id}`, record);
  const settingsConnectionId = seeds.settingsConnectionId === null ? undefined : (seeds.settingsConnectionId ?? 'conn-ok');
  const settingsStore = {
    async getRunAgentSettings(): Promise<RunAgentSettingsRecord | undefined> {
      return settingsConnectionId === undefined ? undefined : { tenantId: 'tenant-local', providerConnectionId: settingsConnectionId, updatedAt: '2026-08-25T00:00:00.000Z', updatedBy: 'principal://op' };
    }
  };
  const controller: TaskControllerPort = {
    async create(): Promise<TaskQueryResult> { return { workflow: { status: 'running' } } as unknown as TaskQueryResult; },
    async query(): Promise<TaskQueryResult> { throw new Error('unused'); },
    async signal(): Promise<TaskQueryResult> { throw new Error('unused'); },
    async cancel(): Promise<TaskQueryResult> { throw new Error('unused'); },
    async retry(): Promise<TaskQueryResult> { throw new Error('unused'); }
  };
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  registerPackageRunsRoutes(app, {
    tenantId: 'tenant-local', controller, releaseResolver: resolver,
    taskStore, specStore: new InMemoryAgentTaskSpecStore(),
    settingsStore, providerConnections: { async listProviderConnections(t: string) { return [...connections.values()].filter((entry) => entry.tenantId === t); }, async getProviderConnection(t: string, id: string) { return connections.get(`${t}/${id}`); } },
    authenticator: { authenticateRequest: () => operator },
    deploymentMode: 'local',
    ...(connector === undefined ? {} : { snapshotConnector: connector }),
    now: () => new Date('2026-08-17T00:00:00.000Z')
  } satisfies RegisterPackageRunsRoutesOptions);
  const url = `/v1/releases/${'a'.repeat(64)}/runs`;
  return {
    storedInputs,
    inject: (payload: unknown) => app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> })
  };
}

const v1Manifest = {
  id: 'demo-assistant', version: '1.0.0', entry: 'prompts/system.md',
  modelRoute: { provider: 'anthropic', model: 'claude-sonnet-4-5' }, skillRefs: [], capabilityRefs: []
};

const errorOf = (response: { json(): unknown }): { code: string; message: string; retryable: boolean } =>
  (response.json() as { error: { code: string; message: string; retryable: boolean } }).error;

describe('package runs v2 admission', () => {
  it('admits a declared task with default params and injected snapshot', async () => {
    const connector = new FakeConnector(() => textResponse(200, '{"items":["repo-a"]}'));
    const h = await harness(v2Manifest, connector);
    const response = await h.inject({ task: 'digest' });
    expect(response.statusCode).toBe(202);
    expect(connector.requests).toContain('https://api.github.com/search/repositories');
    const stored = h.storedInputs[0]!;
    expect(stored.assembledInput).toContain('[snapshot: trending]');
    expect(stored.assembledInput).toContain('{"items":["repo-a"]}');
    expect(stored.assembledInput).toContain('--- params ---');
    expect(stored.assembledInput).toContain('window: 7');
    expect(stored.assembledInput).not.toContain('--- user input ---');
    // 输出契约随包输入固化：schema 资产原文 + 声明文件名，供 worker 物化点校验。
    expect(stored.runContract).toMatchObject({ task: 'digest', files: ['report.md'] });
    expect(stored.runContract?.schema).toContain('"type": "object"');
  });

  it('rejects params violations with PACKAGE_PARAMS_INVALID', async () => {
    const h = await harness(v2Manifest, new FakeConnector(() => textResponse(200, '{}')));
    const cases: ReadonlyArray<{ readonly payload: unknown; readonly detail: string }> = [
      { payload: { task: 'digest', params: { ghost: 1 } }, detail: "Unknown param 'ghost'" },
      { payload: { task: 'digest', params: { window: 90 } }, detail: 'must be one of' },
      { payload: { task: 'digest', params: { window: '7' } }, detail: 'must be one of' },
      { payload: { task: 'ghost' }, detail: "Unknown task 'ghost'" },
      { payload: {}, detail: 'Multiple tasks declared' }
    ];
    for (const testCase of cases) {
      const response = await h.inject(testCase.payload);
      expect(response.statusCode).toBe(400);
      const body = response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('PACKAGE_PARAMS_INVALID');
      expect(body.error.message).toContain(testCase.detail);
    }
    expect(h.storedInputs).toHaveLength(0);
  });

  it('returns 410 INPUT_REMOVED for legacy free-form input', async () => {
    const h = await harness(v2Manifest);
    const response = await h.inject({ input: 'hello' });
    expect(response.statusCode).toBe(410);
    expect(errorOf(response).code).toBe('INPUT_REMOVED');
  });

  it('fails closed when a fail-mode snapshot source errors (502, retryable)', async () => {
    const h = await harness(v2Manifest, new FakeConnector(() => textResponse(503, 'unavailable')));
    const response = await h.inject({ task: 'digest' });
    expect(response.statusCode).toBe(502);
    expect(errorOf(response).code).toBe('PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE');
    expect(errorOf(response).retryable).toBe(true);
    expect(h.storedInputs).toHaveLength(0);
  });

  it('degrades markMissing sources to annotation sections', async () => {
    const manifest = { ...v2Manifest, dataSources: [{ ...v2Manifest.dataSources[0]!, onFailure: 'markMissing' }] };
    const h = await harness(manifest, new FakeConnector(() => textResponse(503, 'unavailable')));
    const response = await h.inject({ task: 'digest' });
    expect(response.statusCode).toBe(202);
    expect(h.storedInputs[0]!.assembledInput).toContain('[snapshot trending unavailable: HTTP_503]');
  });

  it('fails closed for declared dataSources without a connector', async () => {
    const h = await harness(v2Manifest);
    const response = await h.inject({ task: 'digest' });
    expect(response.statusCode).toBe(502);
    expect(errorOf(response).code).toBe('PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE');
  });

  it('rejects oversize snapshot bodies per declared maxBytes', async () => {
    const h = await harness(v2Manifest, new FakeConnector(() => textResponse(200, 'x'.repeat(5000))));
    const response = await h.inject({ task: 'digest' });
    expect(response.statusCode).toBe(502);
    expect(errorOf(response).message).toContain('trending');
  });

  it('keeps v1 manifests equivalent: implicit task, no params/snapshots sections', async () => {
    const h = await harness(v1Manifest);
    const response = await h.inject({});
    expect(response.statusCode).toBe(202);
    const stored = h.storedInputs[0]!;
    expect(stored.assembledInput).not.toContain('--- snapshots ---');
    expect(stored.assembledInput).not.toContain('--- params ---');
    expect(stored.assembledInput).not.toContain('--- user input ---');
    // v1：无任务/输出声明，但 modelRoute 仍固化（执行边界双来源解析的输入）。
    expect(stored.runContract).toMatchObject({ modelRoute: { provider: 'anthropic', model: 'claude-sonnet-4-5' } });
    expect(stored.runContract?.schema).toBeUndefined();
    expect(stored.runContract?.files).toBeUndefined();
    const rejected = await h.inject({ task: 'digest' });
    expect(rejected.statusCode).toBe(400);
  });

  it('admits via manifest route when settings are unset (dual-source resolution)', async () => {
    const manifestRouteEntry: ProviderConnectionRecord = { tenantId: 'tenant-local', id: 'conn-sonnet', name: 'sonnet', source: 'user', adapterKind: 'anthropic', baseUrl: 'https://api.example', modelId: 'claude-sonnet-4-5', enabled: true, credentialPresent: true, createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z' };
    const connector = new FakeConnector(() => textResponse(200, '{}'));
    const noSettings = await harness(v2Manifest, connector, { connections: [manifestRouteEntry], settingsConnectionId: null });
    const response = await noSettings.inject({ task: 'digest' });
    expect(response.statusCode).toBe(202);
  });

  it('rejects with dual-source guidance when neither manifest route nor settings default resolves', async () => {
    const neither = await harness(v1Manifest, undefined, { connections: [], settingsConnectionId: null });
    const response = await neither.inject({});
    expect(response.statusCode).toBe(409);
    expect(errorOf(response).code).toBe('PROVIDER_DEPENDENCY_MISSING');
    expect(errorOf(response).message).toContain('manifest model route');
    expect(errorOf(response).message).toContain('unset');
  });

  it('is idempotent for repeated v2 submissions with identical snapshot content', async () => {
    const connector = new FakeConnector(() => textResponse(200, '{"fixed":true}'));
    const h = await harness(v2Manifest, connector);
    const first = await h.inject({ task: 'digest', taskId: 'pkg-v2fixed' });
    const second = await h.inject({ task: 'digest', taskId: 'pkg-v2fixed' });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect((second.json() as { status: string }).status).toBe('existing');
    expect((second.json() as { taskId: string }).taskId).toBe('pkg-v2fixed');
    expect(h.storedInputs).toHaveLength(1);
  });
});
