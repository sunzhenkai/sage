# 决策契约(轻量 ADR)

| 决策 | 来源 | 状态 |
|------|------|------|
| 首版 Harness 固定 PiHarness | `docs/design/README.md` "Binding" 段 | 已定 |
| Chat 与 Temporal Activity 共用 Agent Library(Loop 不复制) | `docs/design/agent-library-mvp.md`、`docs/design/_cross/generic-agent-platform-final-architecture.md` | 已定 |
| Release 作为不可变事实主键,Run 引用固定 Release | `docs/design/_cross/generic-agent-platform-final-architecture.md` "AgentPackageRelease → AgentTaskSpec" | 已定 |
| Workflow 启动后固定 Cluster/Namespace/Task Queue,不静默迁移 | `docs/design/README.md` "Temporal Task" | 已定 |
| Effect/Consumption Ledger 是唯一 authority | `docs/design/_cross/generic-agent-platform-final-architecture.md` | 已定 |
| ReferenceEnvelope 强制不内联 >8 KiB | `platform/packages/platform-ports/src/runtime.ts` + `agent-state-postgres/src/index.ts` | 已定 |
| `SAGE_*` 环境变量统一前缀 | `platform/compose.yaml` | 已定 |
| 运行时密钥由 Secret Vault 注入,Spec 不写值 | 公共约束 | 已定 |
| Task 是 App 内声明的命名入口,Run 才是执行实例;人工自由文本只属于 Chat | `docs/adr/2026-08-29-task-as-declared-entry.md`、`docs/design/ai-app/app-task-run-model.md` | 已定(P8 随实施落地) |
| App manifest v2 自闭环:inputs/dataSources/tasks/modelRoute/output 全在契约内;自由 `input` 移除(410) | `docs/design/ai-app/app-task-run-model.md`、`platform/packages/agent-package-release/src/source-manifest.ts` | 已定 |
| Canonical Schedule 契约在 platform-ports,HTTP wire 在 app-contracts;adapter 独立成包 `temporal-schedules` | `platform/docs/p8-decisions.md` D1/D2 | 已定 |
| 触发走确定性 dispatcher workflow + 统一包运行准入;occurrence 幂等键三层防静默重复 | `platform/docs/p8-decisions.md` D3 | 已定 |
| FIXED 固化 digest 不漂移;FOLLOW 解析当前 active,不兼容稳定失败告警 | `platform/docs/p8-decisions.md` D5 | 已定 |
| EFFECT_UNKNOWN 不复活终态;裁决落 append-only `agent_effect_resolutions`,动作映射经 `/v1/effects/resolutions` | `platform/docs/p8-decisions.md` D6 | 已定 |
| pilot 链路 service token 强认证(哈希 + 常量时间比较 + 可轮换);stub 信任头停权 | `platform/docs/p8-decisions.md` D7 | 已定 |
| schedule 预算账户在 Ledger 内新增聚合维度(accountRef = `schedule:<scheduleId>`) | `platform/docs/p8-decisions.md` D8 | 已定 |
| 失败分类→告警单一映射表,Prometheus 规则生成 + 未知兜底 | `platform/docs/p8-decisions.md` D10 | 已定 |
| 无人值守 pilot 运行门:五项证据,UNFILLED 即 NO-GO;真实 14 天 soak 保持 UNFILLED(诚实证据纪律) | `platform/docs/p8-decisions.md` 运行门、`platform/docs/p8-risk-ledger.md` | 已定(证据项 UNFILLED) |

开放问题:

- 终版架构的 System Model / Runtime DSL 何时升级为 validated baseline(见 `docs/design/_cross/generic-agent-platform-final-architecture.md` 注脚)?
- 多 Region Task Router 的策略面(数据驻留规则)目前只在 `docs/design/` 有描述,实现尚未启用。
- `agent-platform-conformance/` 子模块(`engine/`、`host/`、`determinism/`、`faults/`)与终版架构的 Gate 关系待 phase 收口。
- P8 运行门当前 NO-GO:真实 14 天 soak 与 oncall roster 证据 UNFILLED,补齐路径见 `platform/docs/p8-risk-ledger.md` 与 pilot-gate 输出。
