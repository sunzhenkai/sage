import { Pool, type PoolConfig } from 'pg';
import type { AdapterHealth, AgentTaskSpecStorePort } from '@sage/platform-ports';

type SpecPut = Parameters<AgentTaskSpecStorePort['putSpec']>[0];
type SpecResult = Awaited<ReturnType<AgentTaskSpecStorePort['putSpec']>>;
type Spec = SpecPut['spec'];

/**
 * agent_task_specs 上的 AgentTaskSpecStorePort，判定顺序与 InMemoryAgentTaskSpecStore 一致：
 * 租户不符抛错 → 同 attempt 不同 ref 为 ATTEMPT_SPEC_CONFLICT → 同 ref 同 digest 为 existing、不同 digest 为 SPEC_REF_CONFLICT。
 * 唯一差异：specRef 在 Postgres 中按租户隔离（主键 (tenant_id, spec_ref)），内存实现为全局。
 */
export class PostgresAgentTaskSpecStore implements AgentTaskSpecStorePort {
  readonly #pool: Pool;
  readonly #ownsPool: boolean;
  constructor(config: PoolConfig | Pool) {
    this.#ownsPool = !(config instanceof Pool);
    this.#pool = config instanceof Pool ? config : new Pool(config);
  }

  async putSpec(input: SpecPut): Promise<SpecResult> {
    if (input.spec.tenantId !== input.tenantId) throw new Error('SPEC_TENANT_MISMATCH');
    const { spec } = input;
    const byAttempt = (await this.#pool.query<{ spec_ref: string }>('SELECT spec_ref FROM agent_task_specs WHERE tenant_id=$1 AND attempt_id=$2', [input.tenantId, spec.attemptId])).rows[0];
    if (byAttempt !== undefined && byAttempt.spec_ref !== spec.specRef) return { status: 'conflict', code: 'ATTEMPT_SPEC_CONFLICT' };
    const inserted = await this.#pool.query(`INSERT INTO agent_task_specs (tenant_id,spec_ref,spec_digest,task_id,run_id,attempt_id,spec)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING spec_ref`,
    [input.tenantId, spec.specRef, spec.specDigest, spec.taskId, spec.runId, spec.attemptId, JSON.stringify(spec)]);
    if (inserted.rowCount === 1) return { status: 'stored', value: structuredClone(spec) };
    const byRef = (await this.#pool.query<{ spec_digest: string; spec: Spec }>('SELECT spec_digest, spec FROM agent_task_specs WHERE tenant_id=$1 AND spec_ref=$2', [input.tenantId, spec.specRef])).rows[0];
    if (byRef === undefined) return { status: 'conflict', code: 'ATTEMPT_SPEC_CONFLICT' };
    return byRef.spec_digest === spec.specDigest ? { status: 'existing', value: byRef.spec } : { status: 'conflict', code: 'SPEC_REF_CONFLICT' };
  }

  async getSpec(input: Parameters<AgentTaskSpecStorePort['getSpec']>[0]): Promise<Spec | undefined> {
    const row = (await this.#pool.query<{ spec: Spec }>('SELECT spec FROM agent_task_specs WHERE tenant_id=$1 AND spec_ref=$2 AND spec_digest=$3', [input.tenantId, input.specRef, input.expectedDigest])).rows[0];
    return row?.spec;
  }

  async health(): Promise<AdapterHealth> {
    try { await this.#pool.query('SELECT 1'); return { healthy: true, checkedAt: new Date().toISOString() }; }
    catch { return { healthy: false, checkedAt: new Date().toISOString(), detail: 'SPEC_STORE_BACKEND_UNAVAILABLE' }; }
  }

  async close(): Promise<void> { if (this.#ownsPool) await this.#pool.end(); }
}
