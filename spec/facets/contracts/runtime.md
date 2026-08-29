# 运行契约(指标 / 灰度 / 回滚)

> 拓扑与启动顺序见 [runtime/INDEX.md](../../runtime/INDEX.md),本节只写指标/灰度/回滚条件。

## 关键指标

| 指标 | 来源 | 用途 |
|------|------|------|
| `agent_runs_total{tenant,state}` | `platform/packages/observability` | Run 数量按状态分布 |
| `agent_run_duration_seconds` | 同上 | Run 时长分布 |
| `effect_ledger_writes_total` | 同上 | Effect Ledger 写入速率 |
| `tool_runtime_egress_blocked_total` | `platform/packages/tool-runtime/src/egress.ts` | Egress 拒绝数 |
| Temporal Worker 心跳 | Temporal 自带 | 存活 |
| `idempotency_claim_hits` | `agent-state-postgres` | 幂等命中 |

## 灰度条件(rollout)

- AgentPackageRelease 准入:Production Governance 通过 → `accepted`,即可被新 Run 引用(`platform/packages/agent-run-admission/src/rollout-policy.ts`);
- Run Admission 在 `admitRun` 处集中控制;无流量开关的情况下直接放行。

## 回滚条件

| 触发 | 行动 |
|------|------|
| Run 错误率超阈值 | 切回上一 `accepted` Release(`agent-release-registry.retire`) |
| Effect Ledger 写入失败 | Run 拒绝继续,Operator 介入 |
| Temporal Cluster 不健康 | Router 选备用 Cluster(TODO) |
| Provider 不可用 | 自动切 Provider(由 `provider-catalog/source.ts` 决策) |

详细 Runbook:

- `platform/docs/agent-package-release-admission-lossless-rollback-runbook.md`
- `platform/docs/agent-runtime-kernel-migration-rollback-runbook.md`
- `platform/docs/agent-platform-production-governance-incidents.md`
- `platform/docs/p7-incident-runbooks.md`
