# TRAFFIC

Sage 暂无对外灰度平台,所有切换都发生在 Sage 内部的两个面:Release 准入 与 Run Admission。本节记录发布与回滚;无生产灰度开关则记「无」。

## 发布

| 面 | 步骤 |
|----|------|
| 代码 | `pnpm check:agent-platform-final` → `pnpm evidence:agent-platform-final` → 部署到目标环境 |
| Release | `POST /v1/agent-packages` → 准入通过 → `state=accepted` |
| Run | `admitRun` 通过 → Agent Library 启动 Run |
| Schedule(P8) | `POST /v1/schedules`(创建即校验绑定并登记 Temporal Schedule)→ dispatcher 按 cron/interval 触发;上产前必须过 pilot-gate(`evaluatePilotGate`,五项证据任一 UNFILLED 即 NO-GO,风险台账见 `platform/docs/p8-risk-ledger.md`) |

## 回滚

| 面 | 步骤 |
|----|------|
| Release | `agent-release-registry.retire` → Run 不可再引用该 Release;已存在的 Run 仍可继续直到自然结束 |
| Code | 回滚镜像/部署到上一版本;Temporal Worker 兼容垫片(`temporal-workflows/worker-compatibility.ts`)避免破坏历史 |
| Effect Ledger | 不允许回滚;若发现错误,通过新增反向 Effect 抵消 |
| Schedule(P8) | pause 或 DELETE 停止后续触发(已产生 Run 不回滚);FOLLOW 绑定换 active Release 由 retire + 新 Release 自然完成 |
| 失败裁决(P8) | `/v1/effects/resolutions` terminate 终止卡死 Run;裁决审计不可改 |

## 影子 / 灰度

无 Sage 自带影子/灰度平台。Operator 可在外部通过多 Cluster 部署对比,但 Router 默认选单一 Cluster,暂不内置分流。

## 指标与告警

见 [contracts/runtime.md](contracts/runtime.md) 关键指标;P8 起告警规则由 `failure-taxonomy.ts` 生成(`platform/observability/prometheus/sage-p8-alerts.yaml`,强制 responder/runbook 注解 + 未知兜底),部署环境加载后路由 oncall;SLO 由部署环境配置,Sage 暂未公布对外 SLO。

## Runbook(产品内部)

- `platform/docs/agent-package-release-admission-lossless-rollback-runbook.md`
- `platform/docs/agent-package-release-admission-rollout-runbook.md`
- `platform/docs/agent-runtime-kernel-migration-rollback-runbook.md`
- `platform/docs/agent-platform-production-governance-incidents.md`
- `platform/docs/p7-incident-runbooks.md`
- `platform/docs/p8-incident-runbooks.md`(P8 无人值守失败处置)
