# state-persistence

Sage 全部运行时状态的 Postgres 与迁移实现。`platform-ports` 定义的 Port 在此实现:`AgentEventStorePort`、`AgentTaskSpecStorePort`、`BoundedRunReceiptStorePort`、`CheckpointStorePort`、`IdempotencyStore`,以及 P8 的 `ScheduleControlStore`。

## 根

| 路径前缀 | 角色 |
|----------|------|
| `platform/packages/agent-state-postgres` | Agent State Postgres 适配(含 `migrations/` SQL 与迁移装配) |
| `platform/packages/postgres-migrations` | 迁移 runner(checksum、重放) |

## 文件(agent-state-postgres)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Postgres 实现(Store Port + Reference Envelope + Fence + Digest);装配 `migrations/` 有序迁移列表 | `createAgentStateAdapter` |
| `effect-ledger.ts` | Effect Ledger 写/读;P8 支持以 `schedule:<scheduleId>` 为 accountRef 的账目维度 | `recordEffect` |
| `consumption-ledger.ts` | Consumption Ledger 派生;P8 schedule 预算账户(reserve 前检查、commit 同事务累加、窗口滚动) | `aggregate` |
| `schedule-store.ts` | P8 Schedule 控制面存储:快照权威(`agent_schedules` snapshot/revision/content_digest)+ append-only 触发事件 | `PostgresScheduleStore` |
| `artifact-checkpoint-store.ts` | Checkpoint Store(Artifact 引用) | `writeCheckpoint` |
| `checkpoint-lifecycle.ts` | Checkpoint 生命周期 | `prune` |
| `audit-store.ts` | 审计写 | `recordAudit` |
| `governance-store.ts` | Production Governance 状态写 | `recordGovernance` |
| `migrations/009_p8_schedule_plane.sql` | P8 迁移:`agent_schedules`、`agent_schedule_trigger_events`(append-only,immutable guard)、`agent_schedule_budget_accounts`/`agent_schedule_budget_accruals` + 全表 RLS | — |
| `migrations/004_production_rls_bootstrap.sql` | RLS 引导(全新库先建角色/策略,再建业务表) | — |
| `*.integration.test.ts` / `*.test.ts`(含 `consumption-ledger-schedule.integration.test.ts`) | 测试 | — |

## 文件(postgres-migrations)

| 文件 | 职责 | 核心 |
|------|------|------|
| `src/index.ts` | 迁移调度与 checksum 重放 | `runPostgresMigrations` |
| `index.test.ts` | 测试 | — |

> 任务面(Projection/包输入/输出契约)迁移在 `platform/packages/task-domain/migrations/`,见 [task-domain](../task-domain/README.md)。

## 对外入口

- `createAgentStateAdapter(pool)` — 主入口;
- `recordEffect` — 单一 authority 入口;
- `writeCheckpoint` / `prune` — Checkpoint 管理;
- `PostgresScheduleStore` — Schedule 控制面(`agent_schedules` 快照权威 + 触发事件);
- `runPostgresMigrations` — 迁移调度。

## 核心符号

- `createAgentStateAdapter` — 把 Postgres Pool 包成 Adapter;
- `recordEffect` — 写 Effect Ledger(ReferenceEnvelope 强制,不内联 >8 KiB);
- `aggregate` — 派生 Consumption Ledger;schedule 触发的 run 记到 `schedule:<scheduleId>` 账户,余额即声明上限,超限 fail closed;
- `PostgresScheduleStore` — 快照 + revision + content_digest 权威;触发事件 append-only(PK 含 kind,不可 UPDATE/DELETE);
- `writeCheckpoint` / `prune` — Artifact + 引用管理;
- `runPostgresMigrations` — 迁移入口。

## 依赖

- 模块 [contracts-and-policy](../contracts-and-policy/README.md) — platform-ports 定义(含 `ScheduleControlStore`)、Production Governance;
- 模块 [agent-lib-runtime](../agent-lib-runtime/README.md) — Port 调用方;
- 模块 [task-domain](../task-domain/README.md) — TaskProjection 也通过该 Adapter;
- 实体 [Schedule 记录](../entities/schedule-record.md);处理线 [schedule-triggered-run](../flows/schedule-triggered-run.md)。
