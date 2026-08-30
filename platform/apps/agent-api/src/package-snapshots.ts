import { buildSnapshotEgressConnector as buildConnector, parseSnapshotEgressAllowlist as parseAllowlist, SNAPSHOT_EGRESS_ALLOWLIST_ENV as ENV_NAME } from '@sage/tool-runtime';
import { fetchScheduleInputSnapshots, PackageSnapshotError, type ScheduleSnapshotConnector } from '@sage/agent-run-admission';

/**
 * 包运行输入快照的受控出口获取。P8 起实现在共享层：
 * - 传输/白名单策略在 tool-runtime（API 与 worker 共用同一策略）；
 * - 逐源获取语义（onFailure: fail | markMissing）在 agent-run-admission（runs-api 与 schedule dispatcher 同一实现）。
 * 本模块保留既有导入面，行为不漂移。
 */
export const SNAPSHOT_EGRESS_ALLOWLIST_ENV = ENV_NAME;
export const parseSnapshotEgressAllowlist = parseAllowlist;
export const buildSnapshotEgressConnector = buildConnector;
export { PackageSnapshotError };
export interface SnapshotFetchResult {
  readonly snapshots: readonly { readonly name: string; readonly url: string; readonly content: string; readonly unavailableReason?: string }[];
}
export async function fetchPackageSnapshots(
  dataSources: readonly { readonly name: string; readonly ref: string; readonly url: string; readonly maxBytes: number; readonly onFailure: 'fail' | 'markMissing' }[],
  connector: ScheduleSnapshotConnector | undefined
): Promise<SnapshotFetchResult> {
  return { snapshots: await fetchScheduleInputSnapshots(dataSources, connector) };
}
