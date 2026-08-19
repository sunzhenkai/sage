## Context

P5 在 P4 单目标的可靠语义之上增加受信任路由。目标信息是控制面配置，绝非模型或普通用户输入；已启动执行不能因 Registry 变更或 Cluster 故障而隐式改变位置。

## Goals / Non-Goals

**Goals:** 管理版本化 TaskType/TargetProfile，依据可信约束选择 target，在 start 前固化 TargetSnapshot，并提供可审计失败语义。

**Non-Goals:** 不暴露 endpoint/Namespace/Task Queue，不自动跨 Cluster 重建/迁移，不动态容量均衡。

## Decisions

- Router 输入仅为受信任 TaskType、租户/环境/区域等经认证约束；它从 Registry 读取候选并产出 policy/registry version、理由和完整 `WorkflowTargetSnapshot`。拒绝任何底层 target 字段。
- snapshot 与业务 Task 在启动 Workflow 前原子持久化；Client Factory 使用 snapshot 的 `credential_ref` 创建客户端。后续 query/signal/cancel/retry 只读取 snapshot。
- 无合法候选返回 `ROUTING_UNAVAILABLE`，不在 API 内执行；目标 Cluster 不可用返回目标不可用，不在其他 Cluster 用同一 workflow 静默再建。
- Registry 发布具有 Owner、审批、版本、审计和回滚；health/capacity/priority/fallback 仅来自可信控制面数据。

## Risks / Trade-offs

- [目标选择不可解释] → 持久化候选过滤、策略版本和理由。
- [控制面不可用] → fail closed，保留原快照操作已启动任务。
- [快照写入与 start 间故障] → 使用待启动状态和可安全重试的 start 协议，绝不选择新 target 覆盖原快照。

## Migration Plan

先引入 Registry schema/发布流程和两个 dev targets，再将 create 路径切换为 Router。可回滚为拒绝新多目标创建；已创建任务继续用原快照。

## Open Questions

P5 Gate 必须先关闭 Owner/审批、存储/审计/回滚、隔离、health/capacity/backlog/priority/fallback 以及 tenant/environment/residency 规则。