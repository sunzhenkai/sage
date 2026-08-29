# VERIFY

如何证明 Sage 的关键行为仍真。SLO/告警由部署环境负责,本节列 Sage 自带的证明手段。

## 测试套件

| 套件 | 命令 | 用途 |
|------|------|------|
| 单元 + 集成(默认排除 p4/p5) | `pnpm test` | 快速反馈 |
| P2 集成 | `pnpm test:p2:integration` | Postgres-backed |
| P3 集成 | `pnpm test:p3:integration` | Postgres + Chat |
| P4 集成 | `pnpm test:p4:integration` | Postgres + Temporal |
| P5 集成 | `pnpm test:p5:integration` | Postgres + Temporal 多环境 |
| P6 端到端 | `pnpm test:p6:e2e` | 可恢复/可重放/可审计 |
| P7 单元 | `pnpm test:p7:unit` | Pilot Admission |
| Production Governance 单元 | `pnpm test:production-governance:unit` | Governance 边界 |
| Production Governance Postgres | `pnpm test:production-governance:postgres:ephemeral` | Effect/Consumption + RLS |
| Production Governance Fault/Load | `pnpm test:production-governance:faults`、`pnpm test:production-governance:load` | Fault 矩阵 |
| 终版架构 unit + temporal | `pnpm test:agent-platform-final:unit`、`pnpm test:agent-platform-final:temporal` | conformance + replay |

## 边界检查

| 命令 | 用途 |
|------|------|
| `pnpm check:deps` | 跨包依赖方向 |
| `pnpm check:production-governance` | 总开关(lint + typecheck + deps + governance + faults + load) |
| `pnpm check:agent-platform-final` | 终版架构 evidence + validate + scan + test |
| `pnpm scan:agent-platform-final` | canonical boundaries / public surfaces / evidence digest / system model / runtime projection / architecture review / traceability |
| `pnpm scan:production-governance` | boundaries + telemetry cardinality + data boundary |

## 性质 / 差分

- Replay 一致性:`platform/packages/temporal-workflows/src/replay-corpus.test.ts` 与 `coordinator-workflow.replay.test.ts` 验证 Coordinator 重放得到同样决策;
- 决定性:Conformance 套件(`platform/packages/agent-platform-conformance/src/determinism/`)验证 Agent Run 在同一输入下行为一致;
- Golden Case:`platform/packages/production-governance/src/golden-vectors.ts` 提供固定输入输出对照。

## 关键测试 ↔ 契约 映射

| 契约 | 测试 |
|------|------|
| Effect Ledger 单一 authority | `agent-state-postgres/effect-ledger.integration.test.ts` |
| Reference Envelope 不内联 >8 KiB | `agent-state-postgres/index.test.ts` 的 `assertReferenceOnly` |
| Chat 流式事件顺序 | `chat-domain/history.test.ts`、`apps/agent-web/chat.runtime.test.tsx` |
| 长请求 Temporal 提升 | `examples/p4-integration/src/p4.integration.test.ts` |
| 多环境 Router | `temporal-routing/p5-routing.test.ts` |
| 可恢复/可重放/可审计 | `examples/p6-integration/src/p6.e2e.test.tsx` + `task-store-postgres/p6-projection.integration.test.ts` + `chat-domain/p6-immutability.integration.test.ts` |
| Release 准入签名失败 | `agent-run-admission/release-run.test.ts` |
| Pilot Admission(P7) | `apps/agent-api/src/pilot-admission.p7.test.ts` |
