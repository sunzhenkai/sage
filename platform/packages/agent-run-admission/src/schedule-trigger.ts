import { sha256Digest } from '@sage/agent-contracts';
import type { AgentTaskSpecStorePort, ScheduleOccurrence } from '@sage/platform-ports';
import { assemblePackageInput, type PackageInputSnapshot } from './package-input.js';
import type { AdmissionAuditOutboxPortV1, AdmissionIdempotencyStoreV1 } from './index.js';
import { admitPackageRun, packageRunIdempotencyKey, packageRunInputDigest, type PackageRunDataSourceDeclaration, type PackageRunManifestSummary } from './release-run.js';

export class PackageSnapshotError extends Error {
  constructor(message: string) { super(message); this.name = 'PackageSnapshotError'; }
}

/** 结构化受控出口连接器（与 tool-runtime 的 ControlledEgressConnectorPort 结构兼容，避免包依赖）。 */
export interface ScheduleSnapshotConnector {
  request(input: { readonly url: string; readonly signal: AbortSignal; readonly maxRedirects?: number }): Promise<{ readonly status: number; readonly headers: Record<string, string | undefined>; readonly body: Uint8Array }>;
}

const SNAPSHOT_FETCH_TIMEOUT_MS = 10_000;

/**
 * 逐声明获取快照（与 agent-api runs-api 同一语义：`onFailure: fail`（缺省）的源失败即整体拒绝；
 * `markMissing` 降级为缺失标注段）。schedule 触发链路复用同一实现，行为不漂移。
 */
export async function fetchScheduleInputSnapshots(
  dataSources: readonly PackageRunDataSourceDeclaration[],
  connector: ScheduleSnapshotConnector | undefined
): Promise<readonly PackageInputSnapshot[]> {
  if (dataSources.length === 0) return [];
  if (connector === undefined) throw new PackageSnapshotError(`PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE: no controlled-egress connector configured (set SAGE_PACKAGE_SNAPSHOT_EGRESS_ALLOWLIST)`);
  const snapshots: PackageInputSnapshot[] = [];
  for (const source of dataSources) {
    const failure = (reason: string): PackageInputSnapshot | undefined =>
      source.onFailure === 'markMissing' ? { name: source.name, url: source.url, content: '', unavailableReason: reason } : undefined;
    try {
      const response = await connector.request({ url: source.url, signal: AbortSignal.timeout(SNAPSHOT_FETCH_TIMEOUT_MS), maxRedirects: 0 });
      if (response.status < 200 || response.status >= 300) {
        const degraded = failure(`HTTP_${response.status}`);
        if (degraded === undefined) throw new PackageSnapshotError(`PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE: ${source.name} returned HTTP ${response.status}`);
        snapshots.push(degraded);
        continue;
      }
      if (response.body.byteLength > source.maxBytes) {
        const degraded = failure('SNAPSHOT_TOO_LARGE');
        if (degraded === undefined) throw new PackageSnapshotError(`PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE: ${source.name} exceeded ${source.maxBytes} bytes`);
        snapshots.push(degraded);
        continue;
      }
      snapshots.push({ name: source.name, url: source.url, content: Buffer.from(response.body).toString('utf8') });
    } catch (cause) {
      if (cause instanceof PackageSnapshotError) throw cause;
      const reason = cause instanceof Error && cause.name === 'TimeoutError' ? 'SNAPSHOT_TIMEOUT' : 'SNAPSHOT_FETCH_FAILED';
      const degraded = failure(reason);
      if (degraded === undefined) throw new PackageSnapshotError(`PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE: ${source.name} ${reason}`);
      snapshots.push(degraded);
    }
  }
  return snapshots;
}

export interface ScheduleReleaseView {
  readonly releaseRef: string;
  readonly releaseId: string;
  readonly releaseDigest: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly ownerRef: string;
  readonly engineIds: readonly string[];
  readonly kernelContractMajor: number;
}

export interface ScheduleDispatchReleaseResolution {
  readonly release: ScheduleReleaseView;
  readonly manifest: PackageRunManifestSummary;
  readonly entryPrompt: string;
  readonly references: readonly { readonly relativePath: string; readonly content: string }[];
  /** 任务声明 output.schema 的资产原文（输出契约固化随包输入物化）。 */
  readonly declaredSchemaAsset?: { readonly relativePath: string; readonly content: string };
}

export interface ScheduleTriggerAdmissionInput {
  readonly tenantId: string;
  readonly principalRef: string;
  readonly occurrence: Pick<ScheduleOccurrence, 'scheduleId' | 'occurrenceId'>;
  /** schedule 固化的 task 与 params（契约 invocation 模板，创建时已按 Release 校验）。 */
  readonly invocation: { readonly task: string; readonly params: Readonly<Record<string, string | number>> };
  readonly release: ScheduleReleaseView;
  readonly manifest: PackageRunManifestSummary;
  readonly entryPrompt: string;
  readonly references: readonly { readonly relativePath: string; readonly content: string }[];
  readonly snapshots: readonly PackageInputSnapshot[];
  readonly specStore: AgentTaskSpecStorePort;
  readonly idempotencyStore: AdmissionIdempotencyStoreV1;
  readonly auditOutbox: AdmissionAuditOutboxPortV1;
  readonly writePackageInput: (record: {
    readonly tenantId: string; readonly taskId: string; readonly releaseId: string; readonly releaseDigest: string;
    readonly assembledInput: string; readonly assetDigests: Readonly<Record<string, string>>; readonly createdAt: string;
    readonly runContract?: { readonly task?: string; readonly schema?: string; readonly files?: readonly string[]; readonly modelRoute?: PackageRunManifestSummary['modelRoute'] };
  }) => Promise<void>;
  readonly startRun: (input: { readonly taskId: string; readonly inputRef: string }) => Promise<void>;
  readonly now: Date;
}

export interface ScheduleTriggerAdmissionResult {
  readonly outcome: 'SUCCEEDED';
  readonly occurrenceKey: string;
  readonly idempotencyKey: string;
  readonly taskId: string;
  readonly runId: string;
  readonly attemptId: string;
  readonly specRef: string;
  readonly specDigest: string;
  readonly releaseId: string;
  readonly releaseDigest: string;
}

export class ScheduleTriggerAdmissionError extends Error {
  constructor(readonly code: string, detail: string) { super(`${code}: ${detail}`); this.name = 'ScheduleTriggerAdmissionError'; }
}

const SLICE_TIMEOUT_CAP_MS = 300_000;

/** 包运行 slice 预算来自 manifest budgets；缺省回退 controller 默认（与 runs-api 同一钳制）。 */
export const scheduleSliceLimits = (budgets?: PackageRunManifestSummary['budgets']) => {
  if (budgets === undefined) return undefined;
  return {
    maxTurns: 1,
    maxToolCalls: Math.min(budgets.maxToolCalls ?? 4, 16),
    maxTokens: Math.min(budgets.maxTokens ?? 8_000, 200_000),
    timeoutMs: Math.min(budgets.maxDurationMs ?? 10_000, SLICE_TIMEOUT_CAP_MS)
  };
};

/**
 * D3：schedule 触发走既有包运行准入。幂等键 = occurrence 幂等键 + task + 固化参数值——
 * 同一 occurrence 重复投递返回同一 task/spec；绑定不兼容（FOLLOW 新 Release 缺同名 task
 * 或 params 不合法）稳定失败并指明不兼容项，不静默跳过、不降级输入。
 */
export async function admitScheduleTrigger(input: ScheduleTriggerAdmissionInput): Promise<ScheduleTriggerAdmissionResult> {
  const { manifest, invocation } = input;
  const occurrenceKey = `schedule:${input.occurrence.scheduleId}:occ:${input.occurrence.occurrenceId}`;

  // 绑定兼容性：同名 task 必须存在于 manifest 声明。
  const declaredTasks = manifest.tasks ?? [];
  const selectedTask = declaredTasks.length > 0 ? declaredTasks.find(task => task.name === invocation.task) : undefined;
  if (selectedTask === undefined) {
    throw new ScheduleTriggerAdmissionError('SCHEDULE_BINDING_INCOMPATIBLE', `release ${input.release.releaseId} declares tasks [${declaredTasks.map(task => task.name).join(', ') || '(none)'}]; schedule binds '${invocation.task}'`);
  }

  // 绑定兼容性：固化 params 必须仍在声明 inputs 内且类型合法；缺省取声明默认值。
  const declaredInputs = manifest.inputs ?? [];
  const providedParams = invocation.params;
  for (const key of Object.keys(providedParams)) {
    if (!declaredInputs.some(declaration => declaration.name === key)) {
      throw new ScheduleTriggerAdmissionError('SCHEDULE_BINDING_INCOMPATIBLE', `param '${key}' is not declared by release ${input.release.releaseId} (declared: ${declaredInputs.map(declaration => declaration.name).join(', ') || '(none)'})`);
    }
  }
  const resolvedInputValues = new Map<string, string | number>();
  for (const declaration of declaredInputs) {
    const raw = providedParams[declaration.name];
    if (raw === undefined) {
      if (declaration.default !== undefined) resolvedInputValues.set(declaration.name, declaration.default);
      continue;
    }
    if (declaration.type === 'number' && typeof raw !== 'number') throw new ScheduleTriggerAdmissionError('SCHEDULE_BINDING_INCOMPATIBLE', `param '${declaration.name}' must be a number`);
    if (declaration.type === 'string' && typeof raw !== 'string') throw new ScheduleTriggerAdmissionError('SCHEDULE_BINDING_INCOMPATIBLE', `param '${declaration.name}' must be a string`);
    if (declaration.type === 'enum' && !(declaration.enum ?? []).includes(raw)) throw new ScheduleTriggerAdmissionError('SCHEDULE_BINDING_INCOMPATIBLE', `param '${declaration.name}' must be one of: ${(declaration.enum ?? []).map(value => String(value)).join(', ')}`);
    resolvedInputValues.set(declaration.name, raw);
  }
  const resolvedParams = (selectedTask.params ?? [])
    .map(binding => binding.from.kind === 'input'
      ? { name: binding.name, value: resolvedInputValues.get(binding.from.input) }
      : { name: binding.name, value: binding.from.value })
    .filter((param): param is { readonly name: string; readonly value: string | number } => param.value !== undefined);

  const declaresV2 = declaredTasks.length > 0 || declaredInputs.length > 0 || (manifest.dataSources?.length ?? 0) > 0;
  const assembled = assemblePackageInput({
    entryPrompt: input.entryPrompt,
    references: input.references.map(reference => ({ relativePath: reference.relativePath, content: reference.content })),
    userInput: '',
    ...(input.snapshots.length > 0 || declaresV2 ? { snapshots: input.snapshots } : {}),
    ...(declaresV2 ? { params: resolvedParams } : {})
  });
  const inputDigest = packageRunInputDigest('', input.release.releaseDigest, assembled.assetDigests, declaresV2 ? { task: selectedTask.name, params: resolvedParams, snapshots: input.snapshots } : undefined);

  // D3：幂等键输入含 task 与固化参数值——参数值不同即不同触发输入。
  const idempotencyKey = packageRunIdempotencyKey(input.tenantId, `schedule:${input.occurrence.scheduleId}`, sha256Digest([occurrenceKey, selectedTask.name, resolvedParams]));
  const occurrenceHash = sha256Digest([input.tenantId, occurrenceKey, input.release.releaseDigest, inputDigest]).slice(7, 19);
  const taskId = `pkg-sched-${input.occurrence.scheduleId.slice(0, 48)}-${occurrenceHash}`;
  const runId = `run-${taskId}`;
  const attemptId = `attempt-${taskId}-1`;
  const inputRef = `task-input://package/${encodeURIComponent(input.tenantId)}/${encodeURIComponent(taskId)}` as const;

  const admitted = await admitPackageRun({
    tenantId: input.tenantId,
    principalRef: input.principalRef,
    taskId, runId, attemptId,
    release: {
      releaseRef: input.release.releaseRef,
      releaseId: input.release.releaseId,
      releaseDigest: input.release.releaseDigest,
      packageId: input.release.packageId,
      packageVersion: input.release.packageVersion,
      ownerRef: input.release.ownerRef,
      engineIds: input.release.engineIds,
      kernelContractMajor: input.release.kernelContractMajor
    },
    manifest,
    inputDigest,
    admittedAt: input.now.toISOString(),
    specStore: input.specStore,
    auditOutbox: input.auditOutbox,
    idempotencyStore: input.idempotencyStore
  });

  if (admitted.status === 'admitted') {
    const declaredSchemaRef = selectedTask.output.schema;
    const declaredSchemaAsset = declaredSchemaRef === undefined ? undefined : input.references.find(asset => asset.relativePath === declaredSchemaRef);
    const declaredFiles = selectedTask.output.files ?? [];
    const manifestRoute = manifest.modelRoute;
    await input.writePackageInput({
      tenantId: input.tenantId, taskId,
      releaseId: input.release.releaseId, releaseDigest: input.release.releaseDigest,
      assembledInput: assembled.text, assetDigests: assembled.assetDigests, createdAt: input.now.toISOString(),
      ...(selectedTask === undefined && declaredSchemaAsset === undefined && declaredFiles.length === 0 && manifestRoute === undefined ? {} : {
        runContract: {
          task: selectedTask.name,
          ...(declaredSchemaAsset === undefined ? {} : { schema: declaredSchemaAsset.content }),
          ...(declaredFiles.length === 0 ? {} : { files: [...declaredFiles] }),
          ...(manifestRoute === undefined ? {} : { modelRoute: manifestRoute })
        }
      })
    });
    await input.startRun({ taskId, inputRef });
  }
  const spec = admitted.spec;
  return {
    outcome: 'SUCCEEDED', occurrenceKey, idempotencyKey,
    taskId: admitted.status === 'admitted' ? taskId : spec.taskId,
    runId: admitted.status === 'admitted' ? runId : spec.runId,
    attemptId: admitted.status === 'admitted' ? attemptId : spec.attemptId,
    specRef: spec.specRef, specDigest: spec.specDigest,
    releaseId: input.release.releaseId, releaseDigest: input.release.releaseDigest
  };
}
