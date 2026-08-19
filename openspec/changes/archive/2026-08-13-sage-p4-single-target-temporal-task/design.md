## Context

P4 将长任务放入一个可信 Temporal dev Target，以验证 Workflow/Activity 边界和重投递恢复。Temporal History 是执行事实源；PostgreSQL Task Store 是允许滞后的产品投影。

## Goals / Non-Goals

**Goals:** 提供确定性 Task Workflow、Activity 中的 Agent Slice、可恢复 checkpoint、幂等副作用、基础 Task API 和投影延迟容忍。

**Non-Goals:** 不选择多个 Target、不做容量均衡、跨 Cluster 迁移或任意用户定义 Workflow。

## Decisions

- `AgentTaskWorkflow` 仅包含引用、状态机、Timer、Signal、CancellationScope 和 Retry；任何 Agent Library、Tool、DB、网络、LLM、Artifact/Secret 访问都在 Activity。active cancel 使用 `WAIT_CANCELLATION_COMPLETED` 与 heartbeat，取消终态优先于任何晚到 Activity result。这保证 replay 确定性且避免取消后状态回写。
- Activity 经 `LocalAgentClient` 执行受 slice 边界限制的 Agent Run。checkpoint 仅在副作用结果有明确提交结论后推进；重投递使用幂等键。`effect_unknown` 在 P4 无 resolution protocol，因此作为终态返回并拒绝 retry，不复用原 attempt/key。
- 创建/查询/signal/cancel/retry 的产品 API 将 Workflow ID 映射到单一 Target；Temporal command 结果与 History 一致，closed Workflow 从 `describe + result` 读取终态，Task Store projection 不可用不阻断 Workflow。
- ledger/outbox 使用 durable primary PG boundary，投影可使用独立 PG client/pool；投影写入采用可重试 outbox/补写方式，并记录投影更新时间而不把 Store 当执行裁决者。

## Risks / Trade-offs

- [Activity 在提交边界崩溃] → 幂等键、checkpoint 提交顺序与 unknown-effect 路径。
- [投影滞后] → API 表示 freshness，P6 引入全面 reconciler。
- [Workflow bundle 不兼容] → 以 P0 Spike 的 Build ID/bundle Gate 阻断实现。

## Migration Plan

先部署单 queue Worker 与 workflow bundle，再启用最小 Task API，随后跑重启/重投递/后端故障测试。回滚停止新建 Task，保留 Worker 处理既有 history 或按 Temporal 兼容策略回退。

## Open Questions

slice 最大时长、Task 保留期、TaskType 版本命名和投影 outbox 细节需在 P4 实现设计中定稿。