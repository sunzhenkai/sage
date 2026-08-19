## Why

长任务必须在一个可信 Temporal Target 上证明可靠重投递、确定性编排与副作用幂等，才能安全地增加多目标路由。单目标纵切将执行事实与产品投影的边界落到可验证实现。

## What Changes

- 实现 `task-domain`、`temporal-workflows`、`agent-worker`、Task Store migration 和最小 Task API。
- 在一个 Temporal dev Target、Namespace/Task Queue 与版本化 TaskType 上运行 `AgentTaskWorkflow`。
- 让 Workflow 仅编排 Timer、Signal、Cancel、Retry 与稳定引用；Activity 经 `LocalAgentClient` 执行 Agent Slice。
- 持久化 checkpoint、Task Projection 与 Artifact 引用，并验证 Worker 重启、Activity Retry、Store 延迟、Agent State 故障与幂等边界。
- 支持创建、查询、Signal、Cancel、Retry，并将其结果与 Temporal History 对齐。

## Capabilities

### New Capabilities
- `single-target-durable-task`: 在单个可信 Temporal Target 上可靠执行、恢复和控制 Agent Task。
- `deterministic-task-workflow`: 不含 I/O 的确定性 Workflow 与 Activity 执行边界。
- `task-projection-baseline`: Temporal 执行事实到可延迟 Task Store 产品投影的基础语义。

### Modified Capabilities

- 无。

## Impact

新增 task/workflow/worker/API packages、Temporal dev 配置与数据 migration。Workflow 不得直接调用 Agent Library、数据库、网络、Secret、LLM 或 Tool；不实现多 Target、容量均衡或自动跨 Cluster 迁移。