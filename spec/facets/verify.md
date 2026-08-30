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
| P8 单元 | `pnpm test:p8:unit` | Schedule 契约/InMemory store/迁移 |
| P8 Temporal 集成 | `pnpm test:p8:integration` | 真实 Temporal Schedules adapter |
| P8 soak 演练 | `pnpm test:p8:exercises` | 压缩时钟 + 5 类故障注入,产出 `evidence/p8/latest/soak-exercise.json` |
| Production Governance 单元 | `pnpm test:production-governance:unit` | Governance 边界 |
| Production Governance Postgres | `pnpm test:production-governance:postgres:ephemeral` | Effect/Consumption + RLS |
| Production Governance Fault/Load | `pnpm test:production-governance:faults`、`pnpm test:production-governance:load` | Fault 矩阵 |
| 终版架构 unit + temporal | `pnpm test:agent-platform-final:unit`、`pnpm test:agent-platform-final:temporal` | conformance + replay |

## 边界检查

| 命令 | 用途 |
|------|------|
| `pnpm check:deps` | 跨包依赖方向(含 `check-p8-boundaries.mjs`:canonical Schedule 契约不泄漏 Temporal 类型) |
| `pnpm check:production-governance` | 总开关(lint + typecheck + deps + governance + faults + load) |
| `pnpm check:agent-platform-final` | 终版架构 evidence + validate + scan + test |
| `pnpm scan:agent-platform-final` | canonical boundaries / public surfaces / evidence digest / system model / runtime projection / architecture review / traceability |
| `pnpm scan:production-governance` | boundaries + telemetry cardinality + data boundary |

## 性质 / 差分

- Replay 一致性:`platform/packages/temporal-workflows/src/replay-corpus.test.ts` 与 `coordinator-workflow.replay.test.ts` 验证 Coordinator 重放得到同样决策;
- 决定性:Conformance 套件(`platform/packages/agent-platform-conformance/src/determinism/`)验证 Agent Run 在同一输入下行为一致;
- Golden Case:`platform/packages/production-governance/src/golden-vectors.ts` 提供固定输入输出对照;
- Schedule 中性 conformance:`temporal-schedules/conformance.ts` 的生命周期 + dispatch 电池,adapter 与 InMemory fakes 共用同一判定;
- 零静默重复:P8 soak 演练以确定性 fakes + 压缩时钟验证 `silentDuplicateCount = 0`(59 触发/86.4% 成功率,阈值 84%),工程证据在 `platform/evidence/p8/latest/soak-exercise.json`;真实 14 天 soak 是运行门证据项,当前 UNFILLED。

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
| Schedule 触发端到端(注册→Release→schedule→触发→admission→durable run→投影一致) | `apps/agent-worker/src/schedules-e2e.test.ts` |
| 输出契约物化点强制 | `apps/agent-worker/src/output-contract.test.ts` |
| 声明参数/数据依赖准入 | `agent-run-admission/package-input.v2.test.ts`、`apps/agent-api/package-runs.v2.test.ts` |
| 运行门 GO/NO-GO | `production-governance/pilot-gate.test.ts` |
| 告警映射与路由覆盖 | `production-governance/failure-taxonomy.test.ts` |
