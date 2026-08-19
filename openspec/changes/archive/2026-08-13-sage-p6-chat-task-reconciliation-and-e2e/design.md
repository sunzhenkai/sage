## Context

P6 汇合 P3 Chat 和 P5 多目标 Task。用户需要从一个 Chat 请求看到可持续任务；系统需要区分产品投影与 Temporal History，并在投影延迟时提供可见 freshness 和修复能力。

## Goals / Non-Goals

**Goals:** 提升 Chat 为 Task、提供完整 Task UI、投影 stale 表达与 reconciliation、端到端关联和故障证据。

**Non-Goals:** 不实现协作/分支 Chat、Schedule、自动跨 Cluster 迁移、Remote Agent Binding 或多 Agent DAG。

## Decisions

- 提升创建不可变 Chat Message↔Task 关联：PostgreSQL `BEFORE UPDATE OR DELETE` trigger 默认拒绝 association DELETE，仅允许 `promotion_pending`→`routed`（及幂等 no-op）；promotion audit 由独立 `BEFORE UPDATE OR DELETE` trigger 强制 append-only。默认以用户显式操作为主；规则提升仅接受受限产品规则并记录触发原因。
- Task UI 从 product projection 读取 timeline，并显示 `projection_updated_at`/stale 状态；控制操作一律经服务读取固化 TargetSnapshot。
- Reconciler 按 snapshot 访问正确 Temporal target，以有界 H1→state→H2 稳定观测读取执行事实；仅 H1/H2 cursor 相同才修复，持续推进/读取故障返回 retryable 并保留 stale。投影写入与事件补写保持幂等并生成修复审计。
- 每条链路传播 tenant/message/session/run/task/workflow/target/attempt correlation；完整性校验拒绝缺失、空白或 malformed 字段。故障注入覆盖 SSE 中断、Worker 重启、Store/Artifact 暂不可用、Cluster unavailable。
- Projection CAS 使用 `(attempt, projection_source, history_event_id)`：History-authoritative 写覆盖普通 writer，低 cursor/同 cursor 冲突拒绝；旧 Worker/control 不得降级已修复事实，更高 History cursor 可表达同 slice 的合法状态转换。
- P6 验收必须连接真实 Temporal、运行真实 Worker/Workflow/Activity 并读取真实 History；坏地址必须失败。七个 P6 指标从业务路径发射并携带 immutable Chat→Task correlation，Dashboard/alerts 提供可部署定义。

## Risks / Trade-offs

- [规则提升误触发] → MVP 限制为显式优先、规则可解释且可禁用。
- [对账造成控制面压力] → 有界批处理、退避和按 stale 信号触发。
- [UI 显示旧状态] → 显式 freshness，而非将缓存误称为实时事实。

## Migration Plan

先落地提升与关联模型，再发布 read-only Task UI，随后开放 Signal/Cancel/Retry，最后启用 reconciler 与告警。可回滚为关闭提升和控制操作；既有 Task 仍按快照处理。

## Open Questions

提升权限、stale 阈值、reconcile 频率/批量、Task UI 保留与 Dashboard Owner 在 P6 开始前确认。