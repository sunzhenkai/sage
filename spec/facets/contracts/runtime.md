# 运行契约(指标 / 灰度 / 回滚)

> 拓扑与启动顺序见 [runtime/INDEX.md](../../runtime/INDEX.md),本节只写指标/灰度/回滚条件。

## 关键指标

| 指标 | 来源 | 用途 |
|------|------|------|
| `agent_runs_total{tenant,state}` | `platform/packages/observability` | Run 数量按状态分布 |
| `agent_run_duration_seconds` | 同上 | Run 时长分布 |
| `effect_ledger_writes_total` | 同上 | Effect Ledger 写入速率 |
| `tool_runtime_egress_blocked_total` | `platform/packages/tool-runtime/src/egress.ts` | Egress 拒绝数 |
| `sage_schedule_trigger_total{outcome,reason_code}`(P8) | `platform/packages/observability`(由 dispatcher 记录) | 定时触发结果分布;低基数,schedule 标识只进日志 |
| Temporal Worker 心跳 | Temporal 自带 | 存活 |
| `idempotency_claim_hits` | `agent-state-postgres` | 幂等命中 |

## 灰度条件(rollout)

- AgentPackageRelease 准入:Production Governance 通过 → `accepted`,即可被新 Run 引用(`platform/packages/agent-run-admission/src/rollout-policy.ts`);
- Run Admission 在 `admitRun` 处集中控制;无流量开关的情况下直接放行;
- Schedule 控制面(P8):创建即生效于 Temporal Schedules;止血手段是 pause/delete,不是灰度放量;无人值守上产由 pilot-gate 裁决(五项证据,UNFILLED 即 NO-GO)。

## 回滚条件

| 触发 | 行动 |
|------|------|
| Run 错误率超阈值 | 切回上一 `accepted` Release(`agent-release-registry.retire`);schedule 的 FOLLOW 绑定自动跟随新 active,FIXED 需重建 schedule |
| Effect Ledger 写入失败 | Run 拒绝继续,Operator 介入 |
| Temporal Cluster 不健康 | Router 选备用 Cluster(TODO) |
| Provider 不可用 | 自动切 Provider(由 `provider-catalog/source.ts` 决策) |
| 调度面异常放大(P8) | `POST /v1/schedules/:id/:action` pause 或 DELETE 止血;已触发 Run 按 taxonomy 裁决 |
| 无人值守失败未裁决(P8) | taxonomy 兜底告警路由 oncall;`/v1/effects/resolutions` retry/replay/terminate |

详细 Runbook:

- `platform/docs/agent-package-release-admission-lossless-rollback-runbook.md`
- `platform/docs/agent-runtime-kernel-migration-rollback-runbook.md`
- `platform/docs/agent-platform-production-governance-incidents.md`
- `platform/docs/p7-incident-runbooks.md`
- `platform/docs/p8-incident-runbooks.md`(P8 无人值守)
