# task-domain

Temporal Task 编排:Task Domain、TaskStore、Task Router、Registry、Workflows,以及 P8 的 Schedule Plane adapter(`temporal-schedules`)。负责把长请求投递到正确 Cluster、Worker Activity 推进 Run、TaskProjection 反映状态;定时触发经 `ScheduleTriggerDispatcher.v1` 走统一的包运行准入。

## 根

| 路径前缀 | 角色 |
|----------|------|
| `platform/packages/task-domain` | Task 领域包(含 `migrations/` 任务面迁移) |
| `platform/packages/task-store-postgres` | Task Projection 的 Postgres 适配 |
| `platform/packages/temporal-registry` | Temporal Cluster/Target 注册表 |
| `platform/packages/temporal-routing` | Task Router、Reconciler、Controller |
| `platform/packages/temporal-workflows` | Coordinator Workflow 与 replay 工具 |
| `platform/packages/temporal-schedules` | Temporal Schedules adapter(Schedule Plane,隔离纪律同 `temporal-workflows`) |

## 文件(task-domain)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 公共导出;包运行运行契约与模型路由解析(`PackageRunContract`、`resolvePackageRunConnection`) | `resolvePackageRunConnection` |
| `migrations/007_task_package_run_contract.sql` | `task_package_input` 增加 `run_contract` 列(准入固化输出 schema/产物名/模型路由) | — |
| `index.test.ts` / `migration.test.ts` / `model-route.test.ts` | 测试 | — |

## 文件(task-store-postgres)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Postgres 实现(TaskProjection、Provider、RunSettings、RunOutput);随 `007` 持久化并比对 `run_contract` | `createTaskStore` |
| `ownership.integration.test.ts` 等 | 测试 | — |

## 文件(temporal-schedules)

| 文件 | 职责 | 核心 |
|------|------|------|
| `src/adapter.ts` | `SchedulePort` 的 Temporal Schedules 实现(cron/interval、pause/resume/delete、触发历史) | `TemporalScheduleAdapter` |
| `src/workflows.ts` | 确定性 dispatcher workflow:纯计算 + 单次 activity 调触发准入;occurrence 幂等键 `schedule:{scheduleId}:occ:{occurrenceId}`(workflow ID = 幂等键);missed 对账 activity 接口 | `ScheduleTriggerDispatcher` |
| `src/conformance.ts` | 中性 Schedule Conformance 电池(生命周期 + dispatch),不依赖 Temporal 类型 | `runScheduleLifecycleConformance` / `runScheduleDispatchConformance` |
| `src/index.test.ts` / `src/adapter.temporal.integration.test.ts` | 测试(后者需真实 Temporal,`pnpm test:p8:integration`) | — |

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

- `task-domain`:`createTask`、`getTask`、任务提升与状态查询;`resolvePackageRunConnection`(模型路由解析);
- `task-store-postgres`:`createTaskStore` 适配;
- `temporal-routing.route(spec)` — 返回 Cluster/Target;
- `temporal-workflows.coordinatorWorkflow` — 注册到 Worker;
- `temporal-schedules.TemporalScheduleAdapter` — Schedule 控制面(adapter),由 agent-api 装配;dispatcher 注册到 Worker(`pnpm test:p8:*`)。

## 核心符号

- `temporal-routing.route` — 按可信 TaskType、环境、能力、隔离、数据驻留选 Cluster;
- `temporal-workflows.coordinatorWorkflow` — Activity 调度、Signal 处理、终态判定;
- `temporal-workflows.replay-gate.evaluate` — Replay 一致性校验;
- `task-store-postgres.createTaskStore` — Postgres 适配 TaskProjection(含 `run_contract`);
- `temporal-registry.registerTarget` — 登记 Temporal Cluster/Target;
- `task-domain.resolvePackageRunConnection` — 按 manifest `modelRoute` 解析执行连接(P8 model-route);
- `temporal-schedules.ScheduleTriggerDispatcher` — 触发→准入的确定性入口,零静默重复(三层幂等,见 [flows/schedule-triggered-run](../flows/schedule-triggered-run.md))。

## 依赖

- 模块 [agent-lib-runtime](../agent-lib-runtime/README.md) — Activity 调 LocalAgentClient;
- 模块 [state-persistence](../state-persistence/README.md) — Agent State 与 Effect/Consumption Ledger;
- 模块 [apps](../apps/README.md) — agent-api 装配 Task API,agent-worker 订阅 Activity。
