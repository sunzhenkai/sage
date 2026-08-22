import { describe, expect, it } from 'vitest';
import type { AgentTaskSpecStorePort, AdapterHealth } from '@sage/platform-ports';
import type { AgentTaskSpec } from '@sage/agent-contracts';
import {
  admitPackageRun,
  packageRunIdempotencyKey,
  packageRunInputDigest,
  type AdmissionAuditOutboxPortV1,
  type AdmissionAuditRecordV1,
  type AdmissionIdempotencyRecordV1,
  type AdmissionIdempotencyStoreV1,
  type PackageRunAdmissionInput,
} from './index.js';
import { assemblePackageInput } from './package-input.js';

class MemorySpecStore implements AgentTaskSpecStorePort {
  readonly #byRef = new Map<string, { readonly tenantId: string; readonly spec: AgentTaskSpec }>();
  async putSpec(input: { readonly tenantId: string; readonly spec: AgentTaskSpec }): Promise<{ readonly status: 'stored' | 'existing'; readonly value: AgentTaskSpec } | { readonly status: 'conflict'; readonly code: 'SPEC_REF_CONFLICT' | 'ATTEMPT_SPEC_CONFLICT' }> {
    const existing = this.#byRef.get(input.spec.specRef);
    if (existing !== undefined) {
      if (existing.tenantId !== input.tenantId || existing.spec.specDigest !== input.spec.specDigest) return { status: 'conflict', code: 'SPEC_REF_CONFLICT' };
      return { status: 'existing', value: structuredClone(existing.spec) };
    }
    this.#byRef.set(input.spec.specRef, { tenantId: input.tenantId, spec: structuredClone(input.spec) });
    return { status: 'stored', value: structuredClone(input.spec) };
  }
  async getSpec(input: { readonly tenantId: string; readonly specRef: string; readonly expectedDigest: string }): Promise<AgentTaskSpec | undefined> {
    const existing = this.#byRef.get(input.specRef);
    if (existing === undefined || existing.tenantId !== input.tenantId || existing.spec.specDigest !== input.expectedDigest) return undefined;
    return structuredClone(existing.spec);
  }
  async health(): Promise<AdapterHealth> { return { healthy: true, checkedAt: '2026-08-17T00:00:00.000Z' }; }
}

const release = {
  releaseRef: 'release://sha256:' + 'a'.repeat(64),
  releaseId: 'sha256:' + 'a'.repeat(64),
  releaseDigest: 'sha256:' + 'b'.repeat(64),
  packageId: 'demo-assistant',
  packageVersion: '1.0.0',
  ownerRef: 'owner://package-platform',
  engineIds: ['engine-local'],
  kernelContractMajor: 1,
};
const manifest = {
  id: 'demo-assistant',
  version: '1.0.0',
  entry: 'prompts/system.md',
  modelRoute: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  skillRefs: ['skill://writer/v1'],
  capabilityRefs: ['capability://file-reader/v1'],
  budgets: { maxTokens: 4000, maxToolCalls: 20 },
};

class MemoryIdempotencyStore implements AdmissionIdempotencyStoreV1 {
  readonly #records = new Map<string, AdmissionIdempotencyRecordV1>();
  async get(input: { readonly tenantId: string; readonly idempotencyKey: string }): Promise<AdmissionIdempotencyRecordV1 | undefined> {
    return this.#records.get(`${input.tenantId}\u0000${input.idempotencyKey}`);
  }
  async putIfAbsent(input: { readonly record: AdmissionIdempotencyRecordV1 }): Promise<{ readonly status: 'created' | 'existing'; readonly record: AdmissionIdempotencyRecordV1 }> {
    const key = `${input.record.tenantId}\u0000${input.record.idempotencyKey}`;
    const existing = this.#records.get(key);
    if (existing !== undefined) return { status: 'existing', record: existing };
    this.#records.set(key, input.record);
    return { status: 'created', record: input.record };
  }
  async putTerminal(input: { readonly record: Extract<AdmissionIdempotencyRecordV1, { readonly status: 'admitted' | 'rejected' }> }): Promise<{ readonly status: 'stored' | 'existing'; readonly record: AdmissionIdempotencyRecordV1 }> {
    const key = `${input.record.tenantId}\u0000${input.record.idempotencyKey}`;
    this.#records.set(key, input.record);
    return { status: 'stored', record: input.record };
  }
}

class MemoryAuditOutbox implements AdmissionAuditOutboxPortV1 {
  readonly records: AdmissionAuditRecordV1[] = [];
  async append(input: { readonly tenantId: string; readonly record: AdmissionAuditRecordV1 }): Promise<'stored' | 'existing'> {
    this.records.push(input.record);
    return 'stored';
  }
}

function baseInput(overrides: Partial<PackageRunAdmissionInput> = {}): PackageRunAdmissionInput {
  const inputDigest = packageRunInputDigest('hello', release.releaseDigest, { 'references/product.md': 'sha256:' + 'c'.repeat(64) });
  return {
    tenantId: 'tenant-local',
    principalRef: 'principal://local',
    taskId: 'pkg-task-1',
    runId: 'run-pkg-task-1',
    attemptId: 'attempt-pkg-task-1-1',
    release,
    manifest,
    inputDigest,
    admittedAt: '2026-08-17T00:00:00.000Z',
    specStore: new MemorySpecStore(),
    auditOutbox: new MemoryAuditOutbox(),
    idempotencyStore: new MemoryIdempotencyStore(),
    ...overrides,
  };
}

describe('package run admission', () => {
  it('commits a create-only spec and signs an envelope from a release + manifest', async () => {
    const input = baseInput();
    const result = await admitPackageRun(input);
    expect(result.status).toBe('admitted');
    expect(result.spec.releaseRef).toBe(release.releaseRef);
    expect(result.spec.releaseDigest).toBe(release.releaseDigest);
    expect(result.spec.goalRef).toBe('goal://package/demo-assistant/1.0.0/prompts/system.md');
    expect(result.spec.skillRefs).toEqual(['skill://writer/v1']);
    expect(result.spec.modelRouteRef).toBe('model://anthropic/claude-sonnet-4-5');
    expect(result.spec.boundsRef).toBe('bounds://package/demo-assistant/4000/20');
    expect(result.envelope.specRef).toBe(result.spec.specRef);
    expect(result.envelope.specDigest).toBe(result.spec.specDigest);

    // Read-back from the spec store must match.
    const stored = await input.specStore.getSpec({ tenantId: input.tenantId, specRef: result.spec.specRef, expectedDigest: result.spec.specDigest });
    expect(stored?.specDigest).toBe(result.spec.specDigest);
  });

  it('is idempotent for the same release + input', async () => {
    const shared = {
      specStore: new MemorySpecStore(),
      auditOutbox: new MemoryAuditOutbox(),
      idempotencyStore: new MemoryIdempotencyStore(),
    };
    const first = await admitPackageRun(baseInput(shared));
    const second = await admitPackageRun(baseInput(shared));
    expect(second.status).toBe('existing');
    expect(second.spec.specDigest).toBe(first.spec.specDigest);
    expect(second.envelope.specRef).toBe(first.envelope.specRef);
  });

  it('produces the expected idempotency key binding tenant + release + input', () => {
    const digest = packageRunInputDigest('hi', release.releaseDigest, {});
    const key = packageRunIdempotencyKey('tenant-local', release.releaseId, digest);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(packageRunIdempotencyKey('tenant-local', release.releaseId, digest)).toBe(key);
    expect(packageRunIdempotencyKey('tenant-other', release.releaseId, digest)).not.toBe(key);
  });
});

describe('package input assembler', () => {
  it('assembles entry prompt + references + user input with asset digests', () => {
    const assembled = assemblePackageInput({
      entryPrompt: '你是演示助手。',
      references: [
        { relativePath: 'references/product.md', content: '# 产品说明\n演示包。' },
      ],
      userInput: '请介绍产品',
    });
    expect(assembled.text).toContain('你是演示助手。');
    expect(assembled.text).toContain('--- references ---');
    expect(assembled.text).toContain('[references/product.md]');
    expect(assembled.text).toContain('--- user input ---');
    expect(assembled.text).toContain('请介绍产品');
    expect(assembled.assetDigests['references/product.md']).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(assembled.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('is deterministic for the same content', () => {
    const input = {
      entryPrompt: 'p',
      references: [{ relativePath: 'references/a.md', content: 'a' }],
      userInput: 'u',
    };
    expect(assemblePackageInput(input).text).toBe(assemblePackageInput(input).text);
    expect(assemblePackageInput(input).digest).toBe(assemblePackageInput(input).digest);
  });
});
