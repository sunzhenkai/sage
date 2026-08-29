import { createHash } from 'node:crypto';
import { sha256Digest, type AgentExecutionEnvelope, type AgentTaskSpec, type ContentDigest } from '@sage/agent-contracts';
import type { AgentTaskSpecStorePort } from '@sage/platform-ports';
import {
  commitAdmissionSpec,
  issueAdmissionEnvelope,
  type AdmissionAuditOutboxPortV1,
  type AdmissionAuditRecordV1,
  type AdmissionIdempotencyRecordV1,
  type AdmissionIdempotencyStoreV1,
  type AdmissionSpecDraftV1,
} from './index.js';

/**
 * 包运行 admission：把已登记的 Release（含 manifest 摘要）映射为 canonical AgentTaskSpec，
 * 复用 create-only putSpec 与 envelope 签发，并以 (tenant, idempotencyKey) 幂等。
 * 本模块不依赖 agent-package-release / agent-release-registry，输入均为纯数据。
 */

/** v2 归一化声明（结构镜像 agent-package-release 的 compiler 归一化形；v1 包不出现这些键）。 */
export interface PackageRunInputDeclaration {
  readonly name: string;
  readonly type: 'string' | 'enum' | 'number';
  readonly enum?: readonly (string | number)[];
  readonly default?: string | number;
  readonly required: boolean;
}

export interface PackageRunDataSourceDeclaration {
  readonly name: string;
  readonly ref: string;
  readonly url: string;
  readonly maxBytes: number;
  readonly onFailure: 'fail' | 'markMissing';
}

export type PackageRunTaskParamBinding =
  | { readonly kind: 'input'; readonly input: string }
  | { readonly kind: 'literal'; readonly value: string | number };

export interface PackageRunTaskDeclaration {
  readonly name: string;
  readonly entry: string;
  readonly params: readonly { readonly name: string; readonly from: PackageRunTaskParamBinding }[];
  readonly output: { readonly schema?: string; readonly files?: readonly string[] };
}

export interface PackageRunManifestSummary {
  readonly id: string;
  readonly version: string;
  readonly entry: string;
  readonly modelRoute: { readonly provider: string; readonly model: string; readonly fallbacks?: readonly string[] };
  readonly skillRefs: readonly string[];
  readonly capabilityRefs: readonly string[];
  readonly budgets?: { readonly maxTokens?: number; readonly maxToolCalls?: number; readonly maxTurns?: number; readonly maxDurationMs?: number };
  readonly inputs?: readonly PackageRunInputDeclaration[];
  readonly dataSources?: readonly PackageRunDataSourceDeclaration[];
  readonly tasks?: readonly PackageRunTaskDeclaration[];
}

export interface PackageRunReleaseIdentity {
  readonly releaseRef: string;
  readonly releaseId: string;
  readonly releaseDigest: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly ownerRef: string;
  readonly engineIds: readonly string[];
  readonly kernelContractMajor: number;
}

export interface PackageRunAdmissionInput {
  readonly tenantId: string;
  readonly principalRef: string;
  readonly taskId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly release: PackageRunReleaseIdentity;
  readonly manifest: PackageRunManifestSummary;
  readonly inputDigest: ContentDigest;
  readonly admittedAt: string;
  readonly specStore: AgentTaskSpecStorePort;
  readonly auditOutbox: AdmissionAuditOutboxPortV1;
  readonly idempotencyStore: AdmissionIdempotencyStoreV1;
  readonly correlationIds?: Readonly<Record<string, string>>;
  readonly environment?: 'local' | 'development' | 'staging' | 'production';
}

export interface PackageRunAdmissionResult {
  readonly status: 'admitted' | 'existing';
  readonly admissionId: string;
  readonly spec: AgentTaskSpec;
  readonly envelope: AgentExecutionEnvelope;
  readonly inputDigest: ContentDigest;
}

export interface PackageRunInputDigestExtras {
  readonly task?: string;
  readonly params?: readonly { readonly name: string; readonly value: string | number }[];
  readonly snapshots?: readonly { readonly name: string; readonly url: string; readonly content: string; readonly unavailableReason?: string }[];
}

export function packageRunInputDigest(
  userInput: string,
  releaseDigest: string,
  assetDigests: Readonly<Record<string, string>>,
  extras?: PackageRunInputDigestExtras
): ContentDigest {
  // v1 调用（无 extras）的 digest 输入保持逐字节不变；extras 仅在出现时参与哈希。
  if (extras === undefined) {
    return sha256Digest({ releaseDigest, userInput, assetDigests: Object.keys(assetDigests).sort().map((key) => [key, assetDigests[key]]) });
  }
  return sha256Digest({
    releaseDigest, userInput,
    assetDigests: Object.keys(assetDigests).sort().map((key) => [key, assetDigests[key]]),
    ...(extras.task === undefined ? {} : { task: extras.task }),
    ...(extras.params === undefined || extras.params.length === 0 ? {} : { params: extras.params.map((param) => [param.name, String(param.value)]) }),
    ...(extras.snapshots === undefined || extras.snapshots.length === 0 ? {} : { snapshots: extras.snapshots.map((snapshot) => [snapshot.name, snapshot.url, sha256Digest(snapshot.content)]) })
  });
}

/** 幂等键：tenant + releaseId + input digest，覆盖同 Release 同输入的重试。 */
export function packageRunIdempotencyKey(tenantId: string, releaseId: string, inputDigest: string): string {
  return createHash('sha256').update(`${tenantId}\u0000${releaseId}\u0000${inputDigest}`).digest('hex');
}

function buildSpecDraft(input: PackageRunAdmissionInput): AdmissionSpecDraftV1 {
  const goalRef = `goal://package/${input.release.packageId}/${input.release.packageVersion}/${input.manifest.entry}`;
  const skillRefs = [...input.manifest.skillRefs];
  const budget = input.manifest.budgets;
  const maxTokens = budget?.maxTokens ?? 32_000;
  const maxToolCalls = budget?.maxToolCalls ?? 32;
  return {
    schemaVersion: '1',
    specRef: `spec://package/${input.taskId}/${input.attemptId}`,
    taskId: input.taskId,
    runId: input.runId,
    attemptId: input.attemptId,
    releaseRef: input.release.releaseRef,
    releaseDigest: input.release.releaseDigest,
    principalRef: input.principalRef,
    tenantId: input.tenantId,
    goalRef,
    engineId: input.release.engineIds[0] ?? 'engine-local',
    skillRefs,
    modelRouteRef: `model://${input.manifest.modelRoute.provider}/${input.manifest.modelRoute.model}`,
    contextPlanRef: 'context://package/empty',
    capabilityGrantRef: input.manifest.capabilityRefs[0] ?? 'grant://package/events',
    executionPolicyRef: 'policy://package/bounded',
    boundsRef: `bounds://package/${input.release.packageId}/${maxTokens}/${maxToolCalls}`,
    governanceRef: 'governance://package/default',
    admittedAt: input.admittedAt,
  };
}

function isPackageRunSpec(spec: AgentTaskSpec): boolean {
  return spec !== null && typeof spec === 'object' && typeof spec.specRef === 'string' && spec.specRef.startsWith('spec://package/');
}

function existingResponse(
  record: Extract<AdmissionIdempotencyRecordV1, { readonly status: 'admitted' }>,
  inputDigest: ContentDigest
): PackageRunAdmissionResult {
  return { status: 'existing', admissionId: record.admissionId, spec: record.spec, envelope: record.envelope, inputDigest };
}

export async function admitPackageRun(input: PackageRunAdmissionInput): Promise<PackageRunAdmissionResult> {
  const idempotencyKey = packageRunIdempotencyKey(input.tenantId, input.release.releaseId, input.inputDigest);
  const admissionId = `admission-${input.taskId}-${input.attemptId}`;

  const existing = await input.idempotencyStore.get({ tenantId: input.tenantId, idempotencyKey });
  if (existing !== undefined) {
    if (existing.status === 'admitted' && isPackageRunSpec(existing.spec)) return existingResponse(existing, input.inputDigest);
    throw new Error('PACKAGE_RUN_ADMISSION_IDEMPOTENCY_CONFLICT');
  }

  const processing: AdmissionIdempotencyRecordV1 = {
    schemaVersion: '1', tenantId: input.tenantId, idempotencyKey, requestDigest: input.inputDigest,
    admissionId, status: 'processing',
  };
  const claimed = await input.idempotencyStore.putIfAbsent({ record: processing });
  if (claimed.status === 'existing') {
    if (claimed.record.status === 'admitted' && isPackageRunSpec(claimed.record.spec)) return existingResponse(claimed.record, input.inputDigest);
    throw new Error('PACKAGE_RUN_ADMISSION_IDEMPOTENCY_CONFLICT');
  }

  const draft = buildSpecDraft(input);
  const committed = await commitAdmissionSpec({ tenantId: input.tenantId, draft, specStore: input.specStore });

  const auditRecord: AdmissionAuditRecordV1 = {
    schemaVersion: '1',
    auditRef: `audit://${input.tenantId}/${input.taskId}/${input.attemptId}`,
    tenantId: input.tenantId,
    admissionId,
    attemptId: input.attemptId,
    stage: 'SPEC',
    outcome: 'accepted',
    subjectDigest: committed.spec.specDigest as ContentDigest,
    occurredAt: input.admittedAt,
  };
  await input.auditOutbox.append({ tenantId: input.tenantId, record: auditRecord });

  const admitted = await issueAdmissionEnvelope({
    tenantId: input.tenantId,
    admissionId,
    invocationId: input.taskId,
    spec: committed.spec,
    specStore: input.specStore,
    auditRecords: [auditRecord],
    outbox: input.auditOutbox,
    ...(input.correlationIds === undefined ? {} : { correlationIds: input.correlationIds }),
  });

  const terminal: Extract<AdmissionIdempotencyRecordV1, { readonly status: 'admitted' }> = {
    schemaVersion: '1', tenantId: input.tenantId, idempotencyKey, requestDigest: input.inputDigest,
    admissionId, status: 'admitted', spec: committed.spec, envelope: admitted.envelope,
  };
  await input.idempotencyStore.putTerminal({ record: terminal });

  return { status: 'admitted', admissionId, spec: committed.spec, envelope: admitted.envelope, inputDigest: input.inputDigest };
}
