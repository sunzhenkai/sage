# 行为契约

每条契约给一句话 + 关键测试路径。

| 契约 | 测试 | 备注 |
|------|------|------|
| Chat 短请求流式返回完整事件序列 | `platform/packages/chat-domain/src/history.test.ts` `platform/apps/agent-web/src/chat.runtime.test.tsx` | 含 `done` 终态 |
| Chat 长请求提升后 Workflow 启动 + 状态可查 | `platform/examples/p4-integration/src/p4.integration.test.ts` | p4 集成 |
| Multi-env Router 选 Cluster 后 Workflow 固定 | `platform/packages/temporal-routing/src/p5-routing.test.ts` | p5 |
| Replay 一致性:Coordinator 重放得到同样决策 | `platform/packages/temporal-workflows/src/replay-corpus.test.ts` `coordinator-workflow.replay.test.ts` | p5/终版 |
| AgentPackageRelease 准入签名失败必拒绝 | `platform/packages/agent-run-admission/src/release-run.test.ts` | — |
| Production Governance Fault 矩阵:Effect Ledger 缺则 Run 拒绝 | `platform/examples/production-governance-integration/src/fault-matrix.integration.test.ts` | — |
| Effect Ledger 不内联 >8 KiB(ReferenceEnvelope 强制) | `platform/packages/agent-state-postgres/src/effect-ledger.integration.test.ts` | — |
| RLS:租户隔离在 Effect/Consumption 上生效 | `platform/packages/agent-state-postgres/src/rls.integration.test.ts` | — |
