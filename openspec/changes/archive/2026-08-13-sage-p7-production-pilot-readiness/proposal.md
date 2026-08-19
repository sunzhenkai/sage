## Why

功能验收通过不代表可受控地进入生产试运行。MVP 需要在不扩大产品范围的前提下证明可恢复、可观测、安全、可升级且对 Cluster 故障不会静默重复执行。

## What Changes

- 明确并实施 API、PostgreSQL、Artifact、Registry、Secret Manager 的 HA/RTO/RPO 与责任边界。
- 演练 PostgreSQL/Artifact 备份恢复、数据删除、Worker Build ID 兼容部署、回滚及长 Workflow 版本策略。
- 建立保留期、租户隔离、访问审计、Secret 轮换和关键安全检查。
- 对路由失败、Cluster unavailable、Queue backlog、Activity Retry、projection lag、`effect_unknown` 与投影漂移建立告警与 Runbook。
- 完成安全、架构与试运行 Go/No-Go 评审证据。

## Capabilities

### New Capabilities
- `production-pilot-resilience`: 面向试运行的备份恢复、HA、兼容部署、回滚和演练证据。
- `production-task-observability`: 可关联 task/workflow/target/attempt/run/tool-call 的告警和处置流程。
- `production-data-and-secret-governance`: 保留、隔离、删除、审计及 Secret 轮换的生产治理。
- `pilot-go-no-go-governance`: 有 Owner、风险结论与签署记录的生产试运行准入。

### Modified Capabilities

- 无。

## Impact

影响部署/运行手册、监控告警、备份策略、生产控制面与发布流程；不引入自动跨 Cluster 迁移、Global Namespace、动态 Worker 市场、Sandbox 或其他已延期能力。