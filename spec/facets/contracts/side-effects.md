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

SOURCE:对应测试路径;副作用写入事务边界由 `agent-state-postgres/src/index.ts` 的 `assertReferenceOnly` 与 `IdempotencyClaim` 强制。
