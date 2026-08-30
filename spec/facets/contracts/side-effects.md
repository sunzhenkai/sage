# 副作用契约

| 副作用 | 触发 | 落地 | 测试 |
|--------|------|------|------|
| LLM 调用 | Agent Loop 内 `callLLM` | `effect_ledger_entries` + Provider 日志 | `tool-runtime/effect-ledger.integration.test.ts` |
| Tool 调用 | Sandbox 工具执行 | `effect_ledger_entries` + Artifact 引用 | `tool-runtime/sandbox.test.ts` |
| Artifact 写入 | Checkpoint/Artifact | Postgres 元数据 + MinIO blob | `agent-state-postgres/artifact-checkpoint-store.integration.test.ts` |
| 状态变更 | AgentRun 推进 | `agent_runs` + Effect Ledger(同事务) | `agent-state-postgres/checkpoint-lifecycle.integration.test.ts` |
| Release 登记 | 提交 Package | `agent_package_releases` | `agent-run-admission/release-run.test.ts` |
| TaskProjection 更新 | Reconciler | `task_projections` | `task-store-postgres/p6-projection.integration.test.ts` |
| Egress 检查 | Tool 调用出站 | 拒绝/允许日志 | `tool-runtime/egress.test.ts` |
| Schedule 触发事件(P8) | 每次 occurrence 到期/跳过/丢失 | `agent_schedule_trigger_events` append-only(immutable guard 触发器;SUCCEEDED/FAILED/SKIPPED/MISSED) | `agent-state-postgres/src/runtime-migration.test.ts`、`apps/agent-worker/schedules-e2e.test.ts` |
| Schedule 预算结算(P8) | 触发 run commit | `agent_schedule_budget_accruals` append-only(commit 同事务累加,幂等去重)+ `agent_schedule_budget_accounts` 窗口滚动 | `agent-state-postgres/consumption-ledger-schedule.integration.test.ts` |
| EFFECT_UNKNOWN 裁决(P8) | Oncall 提交 `/v1/effects/resolutions` | `agent_effect_resolutions` append-only 审计;动作经既有任务控制面(retry 新 attempt / Ledger replay / terminate) | `apps/agent-api/effect-resolutions-api.test.ts` |
| Schedule 管理操作审计(P8) | 创建/pause/resume/delete | 审计写(带 correlation) | `apps/agent-api/schedules-api.test.ts` |
| 快照受控抓取(P8) | 准入期 dataSources 获取 | 白名单 connector(`SAGE_PACKAGE_SNAPSHOT_EGRESS_ALLOWLIST`,default-deny);内容入 inputDigest | `agent-run-admission/schedule-trigger.ts` 测试 |

SOURCE:对应测试路径;副作用写入事务边界由 `agent-state-postgres/src/index.ts` 的 `assertReferenceOnly` 与 `IdempotencyClaim` 强制;append-only 由 009 迁移的 `sage_governance_immutable_guard()` 触发器强制。
