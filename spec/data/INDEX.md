# 数据(data/)

持久化与一致性。所有运行时数据都落在两个物理引擎上:PostgreSQL 17.6(主数据/队列/账本)与 S3 兼容 Artifact Store(对象/Checkpoint)。

## 存储实例

| 实例 | 引擎 | 角色 | 谁读写 |
|------|------|------|--------|
| Chat/Task/Agent 业务库(`sage`) | Postgres 17.6 | 主数据:Chat Session、Task Projection、Agent State、Effect/Consumption Ledger、Artifact 元数据 | agent-api(读写 Chat/Task)、agent-worker(读写 Agent State、Ledger)、postgres-migrations(只写 schema) |
| Temporal Server DB | Postgres 17.6(同库,独立 schema) | Temporal Workflow/Activity 历史与可见性 | Temporal Server(Temporalio auto-setup) |
| Artifact Store | MinIO(S3 兼容) | 大对象、Checkpoint blob、Run 输出快照 | agent-api/agent-worker 通过 S3 SDK;runtime 引用 |

## 与实体的差

| 实体 | 落在哪 | 备注 |
|------|--------|------|
| [ChatSession](../entities/chat-session.md) | Chat 库 `chat_sessions` 等表 | chat-domain 通过 `history.ts` 读写 |
| [TaskProjection](../entities/task-projection.md) | Chat/Task 库 `task_*` 表;`task_package_input.run_contract`(007)存准入固化的输出 schema/产物名/模型路由 | task-store-postgres |
| [AgentRun](../entities/agent-run.md) | Agent State 库 `agent_runs` 等表 | agent-state-postgres |
| [AgentPackageRelease](../entities/agent-package-release-record.md) | Release 库 `agent_package_releases` | agent-release-registry |
| [EffectLedger](../entities/effect-ledger-record.md) | Effect 库 `effect_ledger_entries`;EFFECT_UNKNOWN 裁决落 append-only `agent_effect_resolutions`(005 起既有) | agent-state-postgres |
| [ConsumptionLedger](../entities/consumption-ledger-record.md) | Consumption 库 `consumption_ledger_entries` | agent-state-postgres |
| [Schedule 记录](../entities/schedule-record.md) | `agent_schedules`(快照权威)、`agent_schedule_trigger_events`(append-only 触发事件)、`agent_schedule_budget_accounts`/`agent_schedule_budget_accruals`(预算) | agent-state-postgres(009) |
| Artifact Blob | Artifact Store | 元数据在 Postgres,大对象在 MinIO |
| Temporal History | Temporal Server DB | 由 Temporal 自动维护,不归 Spec 管 |

## 迁移与索引

- 迁移工具:`postgres-migrations`(runner:checksum + 重放)与 `platform/scripts/production-governance/migration-preflight.mjs`;
- 迁移目录:按包存放 — `platform/packages/agent-state-postgres/migrations/`(001–009,SQL 有序装配于 `src/index.ts`;004 为 RLS 引导,009 为 P8 调度面)与 `platform/packages/task-domain/migrations/`(任务面 001–007,007 加 `run_contract`);
- 关键索引:由各 Store 包定义,例如 `chat_sessions(session_id)`、`task_projections(task_id)`、`agent_runs(run_id)`;009 另有 `agent_schedules_state_idx`、触发事件时间倒序索引;
- 唯一约束:Release Registry 的 `version`、Effect Ledger 的 `effect_id`、Consumption Ledger 的 `consumption_id` 均唯一;`agent_schedules`/触发事件/预算表以 `(tenant_id, schedule_id[, occurrence_id, kind])` 为主键;
- 一致性:Effect/Consumption Ledger 写入走同一 Postgres 事务,Checkpoint 引用以 Reference Envelope 写入,不允许内联超 8 KiB(由 `assertReferenceOnly` 强制);009 四张表全部 FORCE ROW LEVEL SECURITY(`sage_tenant_isolation` 策略),触发事件与预算累加由 `sage_governance_immutable_guard()` 触发器保证 append-only。

## 一致性与保留

- 事务边界在 Postgres 内,以 Store 包为单位;跨包事务通过 Effect Ledger 的因果串接;
- 重复投递靠 `IdempotencyClaim` 表 + Agent Run Fence 双判;P8 schedule 触发另加三层幂等(workflow ID = `schedule:{id}:occ:{n}`、admission 幂等键含 task+固化 params、task store 唯一约束);
- schedule 预算:commit 与结算同事务累加 `agent_schedule_budget_accruals`(幂等去重),窗口滚动由 check 触发重置,超限 fail closed;
- 保留:Chat 历史与 Task Projection 默认保留至生产治理脚本定义;Artifact 默认无限期保留(可配);
- 归档:旧 Task 通过 Temporal Retention 配置(默认未设);
- 删除:删除链路经过 `production-governance` 的边界检查,不得绕过 Effect Ledger。

## 数据自检

- [ ] 所有实体有对应 Postgres 表或 S3 prefix;
- [ ] 所有写路径经过 Effect/Consumption Ledger;
- [ ] 没有内联大对象(>8 KiB)落到 Postgres;
- [ ] 迁移脚本可重放,且有 preflight 校验。
