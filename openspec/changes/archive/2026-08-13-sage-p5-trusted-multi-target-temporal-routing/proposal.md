## Why

单目标可靠 Task 已经验证后，系统需要按可信、可审计配置将任务路由到多个隔离的 Temporal Target。用户或模型绝不能控制 endpoint、Namespace、Task Queue 等运行时基础设施。

## What Changes

- 实现版本化 `TaskType`、`TemporalTargetProfile` Registry、Task Router 与 Temporal Client Factory。
- 使用 `credential_ref` 动态解析 Temporal 凭据，并记录 policy/registry version 与路由解释。
- 在启动 Workflow 前持久化完整 `WorkflowTargetSnapshot`；其后的 query、signal、cancel、retry 均复用该快照。
- 支持至少两个 TaskType 与两个 Target/Task Queue 的可信自动选择。
- 验证路由矩阵、无合法目标、Registry 变更和目标 Cluster 不可用语义。

## Capabilities

### New Capabilities
- `trusted-temporal-routing`: 仅由受信任 TaskType 和目标策略驱动的 Temporal 路由。
- `workflow-target-snapshot`: Workflow 启动前持久化且生命周期内不可隐式迁移的 Target 快照。
- `routing-audit-and-failure-semantics`: 可解释路由审计、`ROUTING_UNAVAILABLE` 和目标不可用行为。

### Modified Capabilities

- 无。

## Impact

新增 routing/registry/client-factory、控制面 schema 和审计数据。该 change 依赖 P5 前关闭 Owner、审批、隔离、health/capacity/priority/fallback 与驻留约束决策；不开放原始 Target 字段，也不实现自动跨 Cluster 续跑。