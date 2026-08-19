## Context

P7 不扩张 MVP 功能，而是将 P6 的完整链路带到受控生产试运行。其关注点是控制面和数据恢复、兼容部署、告警/Runbook 与不可静默重复执行的故障处置。

## Goals / Non-Goals

**Goals:** 确立 HA/RTO/RPO、备份恢复、Build ID 升级/回滚、数据/Secret 治理、可关联告警、演练和 Go/No-Go 证据。

**Non-Goals:** 不以生产化为名引入 Global Namespace、自动跨 Cluster 迁移、动态 Worker 市场或 Sandbox。

## Decisions

- 对 API、PostgreSQL、Artifact、Registry、Secret Manager 分别记录可接受 RTO/RPO、单点风险和 Owner；未有书面接受/缓解结论即不 Go。
- Temporal Worker 使用 Build ID 兼容集、渐进部署与回滚演练；长 Workflow 通过版本化 Workflow 代码维持 deterministic replay。
- 备份/恢复与数据删除按最小特权、审计和演练验证；Secret 轮换只通过 ref/provider 完成，不暴露值到运行记录。
- 告警必须能关联 task/workflow/target/attempt/run/tool-call，覆盖路由/Cluster、queue、retry、projection 和 `effect_unknown`，并指向具名 Runbook/责任人。
- Cluster 事故默认等待恢复或走带外显式迁移：新 workflow_id、新 snapshot、审计和人工批准；禁止静默重复执行。

## Risks / Trade-offs

- [HA 成本高] → 在 Go/No-Go 明确接受残余风险或延后试运行。
- [恢复演练影响数据] → 隔离演练环境、定义数据窗口和回滚步骤。
- [告警噪音] → 每条告警有阈值、Owner、去重与演练验证。

## Migration Plan

先完成生产配置和备份，再进行恢复/升级/控制面/Cluster 故障演练，最后由安全、架构、运维共同签署。未通过则停止新租户或新任务进入试运行，修复后重新演练。

## Open Questions

生产租户与数据分类、RTO/RPO、备份保留、HA 投资、发布 Owner、值班轮值及告警阈值必须在 Go/No-Go 前关闭。