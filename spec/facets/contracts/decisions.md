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

开放问题:

- 终版架构的 System Model / Runtime DSL 何时升级为 validated baseline(见 `docs/design/_cross/generic-agent-platform-final-architecture.md` 注脚)?
- 多 Region Task Router 的策略面(数据驻留规则)目前只在 `docs/design/` 有描述,实现尚未启用。
- `agent-platform-conformance/` 子模块(`engine/`、`host/`、`determinism/`、`faults/`)与终版架构的 Gate 关系待 phase 收口。
