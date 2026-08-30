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
| 包运行仅接受声明参数:未声明/类型不符/缺必填 → 400 `PACKAGE_PARAMS_INVALID` | `platform/apps/agent-api/src/package-runs.v2.test.ts` | P8 manifest v2 |
| 自由文本 `input` 已移除:出现即 410 `INPUT_REMOVED` | 同上 | P8 废弃窗口结束 |
| Schedule occurrence 三层幂等:同 occurrence 重放不产生第二个 Run(零静默重复) | `platform/apps/agent-worker/src/schedules-e2e.test.ts` `platform/packages/agent-run-admission/src/schedule-trigger.ts` 测试 | P8;workflow ID = 幂等键 |
| FIXED 绑定 digest 不漂移;FOLLOW 解析不兼容(缺 task/params 不合法)即稳定失败告警,不静默跳过 | 同上 | P8 决策 D5 |
| 输出契约:模型输出不符 `task.output.schema`/files → `PACKAGE_OUTPUT_CONTRACT_VIOLATION`,任务失败可重试 | `platform/apps/agent-worker/src/output-contract.test.ts` | P8 物化点强制 |
| Schedule 预算超限 fail closed,自动重试不绕过 Ledger | `platform/packages/production-governance/src/failure-taxonomy.test.ts` `agent-state-postgres/consumption-ledger-schedule.integration.test.ts` | P8 重试预算护栏 |
| pilot-gate:任一证据 UNFILLED → NO-GO 并列补齐路径;关键前置回归即回 NO-GO | `platform/packages/production-governance/src/pilot-gate.test.ts` | P8 运行门 |
| service token:哈希常量时间比较;配置生效后 stub 信任头停止提权 | `platform/apps/agent-api/src/schedules-api.test.ts` 等 | P8 五链路 |
