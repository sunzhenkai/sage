# task-domain

Temporal Task 编排:Task Domain、TaskStore、Task Router、Registry、Workflows。负责把长请求投递到正确 Cluster、Worker Activity 推进 Run、TaskProjection 反映状态。

## 根

| 路径前缀 | 角色 |
|----------|------|
| `platform/packages/task-domain` | Task 领域包 |
| `platform/packages/task-store-postgres` | Task Projection 的 Postgres 适配 |
| `platform/packages/temporal-registry` | Temporal Cluster/Target 注册表 |
| `platform/packages/temporal-routing` | Task Router、Reconciler、Controller |
| `platform/packages/temporal-workflows` | Coordinator Workflow 与 replay 工具 |

## 文件(task-domain)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 公共导出 | — |
| `index.test.ts` / `migration.test.ts` | 测试 | — |

## 文件(task-store-postgres)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Postgres 实现(TaskProjection、Provider、RunSettings、RunOutput) | `createTaskStore` |
| `ownership.integration.test.ts` 等 | 测试 | — |

## 文件(temporal-registry)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Cluster/Target 注册与查询 | `registerTarget` |

## 文件(temporal-routing)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Router 入口 | `route` |
| `p5-controller.test.ts` 等 | 测试 | — |

## 文件(temporal-workflows)

| 文件 | 职责 | 核心 |
|------|------|------|
| `coordinator-workflow.ts` | Coordinator Workflow(主 Run) | `coordinatorWorkflow` |
| `replay-corpus.ts` | Replay Corpus | `loadCorpus` |
| `replay-gate.ts` | Replay Gate(准入) | `evaluate` |
| `worker-compatibility.ts` | Worker SDK 兼容性垫片 | `compat` |
| `*.test.ts` | 测试(含 replay corpus) | — |

## 对外入口

- `task-domain`:`createTask`、`getTask`、任务提升与状态查询;
- `task-store-postgres`:`createTaskStore` 适配;
- `temporal-routing.route(spec)` — 返回 Cluster/Target;
- `temporal-workflows.coordinatorWorkflow` — 注册到 Worker。

## 核心符号

- `temporal-routing.route` — 按可信 TaskType、环境、能力、隔离、数据驻留选 Cluster;
- `temporal-workflows.coordinatorWorkflow` — Activity 调度、Signal 处理、终态判定;
- `temporal-workflows.replay-gate.evaluate` — Replay 一致性校验;
- `task-store-postgres.createTaskStore` — Postgres 适配 TaskProjection;
- `temporal-registry.registerTarget` — 登记 Temporal Cluster/Target。

## 依赖

- 模块 [agent-lib-runtime](../agent-lib-runtime/README.md) — Activity 调 LocalAgentClient;
- 模块 [state-persistence](../state-persistence/README.md) — Agent State 与 Effect/Consumption Ledger;
- 模块 [apps](../apps/README.md) — agent-api 装配 Task API,agent-worker 订阅 Activity。
