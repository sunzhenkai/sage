# state-persistence

Sage 全部运行时状态的 Postgres 与迁移实现。`platform-ports` 定义的 Port 在此实现:`AgentEventStorePort`、`AgentTaskSpecStorePort`、`BoundedRunReceiptStorePort`、`CheckpointStorePort`、`IdempotencyStore`。

## 根

| 路径前缀 | 角色 |
|----------|------|
| `platform/packages/agent-state-postgres` | Agent State Postgres 适配 |
| `platform/packages/postgres-migrations` | 迁移目录与调度器 |

## 文件(agent-state-postgres)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Postgres 实现(Store Port + Reference Envelope + Fence + Digest) | `createAgentStateAdapter` |
| `effect-ledger.ts` | Effect Ledger 写/读 | `recordEffect` |
| `consumption-ledger.ts` | Consumption Ledger 派生 | `aggregate` |
| `artifact-checkpoint-store.ts` | Checkpoint Store(Artifact 引用) | `writeCheckpoint` |
| `checkpoint-lifecycle.ts` | Checkpoint 生命周期 | `prune` |
| `audit-store.ts` | 审计写 | `recordAudit` |
| `governance-store.ts` | Production Governance 状态写 | `recordGovernance` |
| `*.integration.test.ts` / `*.test.ts` | 测试 | — |

## 文件(postgres-migrations)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 迁移调度 | `runMigrations` |
| `index.test.ts` | 测试 | — |

## 对外入口

- `createAgentStateAdapter(pool)` — 主入口;
- `recordEffect` — 单一 authority 入口;
- `writeCheckpoint` / `prune` — Checkpoint 管理;
- `runMigrations` — 迁移调度。

## 核心符号

- `createAgentStateAdapter` — 把 Postgres Pool 包成 Adapter;
- `recordEffect` — 写 Effect Ledger(ReferenceEnvelope 强制,不内联 >8 KiB);
- `aggregate` — 派生 Consumption Ledger;
- `writeCheckpoint` / `prune` — Artifact + 引用管理;
- `runMigrations` — 迁移入口。

## 依赖

- 模块 [contracts-and-policy](../contracts-and-policy/README.md) — platform-ports 定义、Production Governance;
- 模块 [agent-lib-runtime](../agent-lib-runtime/README.md) — Port 调用方;
- 模块 [task-domain](../task-domain/README.md) — TaskProjection 也通过该 Adapter。
