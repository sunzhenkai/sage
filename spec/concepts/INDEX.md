# 概念(concepts/)

Sage 领域语词表。每一项一行定义 + 在哪里出现。

| 概念 | 一句话 | 页 |
|------|--------|-----|
| Agent Library | 单一可嵌入的 Agent Run 内核,Chat 与 Temporal Activity 共享 | [agent-library.md](agent-library.md) |
| PiHarness | 当前唯一被支持的 Harness,封装 LLM/Tool/Context 调用循环 | [pi-harness.md](pi-harness.md) |
| AgentPackageRelease | Agent Package 的不可变发布单元,Release Registry 的事实主键 | [agent-package-release.md](agent-package-release.md) |
| AgentTaskSpec | 一次 Agent Run 的可执行规格,由 Release + 输入派生 | [agent-task-spec.md](agent-task-spec.md) |
| AgentExecutionEnvelope | Run 的运行时容器:Context + RuntimeCorrelation + Capability 集合 | [agent-execution-envelope.md](agent-execution-envelope.md) |
| Effect Ledger | 唯一 authority:记录 Run 期间所有外部副作用与计费点 | [effect-ledger.md](effect-ledger.md) |
| Consumption Ledger | 派生 authority:对 Effect 做租户/容量/成本归集 | [consumption-ledger.md](consumption-ledger.md) |
| Task Router | 选 Temporal Cluster 的策略器,Workflow 启动后固定 | [task-router.md](task-router.md) |
| Capability / MCP | Agent 可调用的能力,通过 MCP 暴露给 Tool Runtime | (见 [tool-runtime 模块](../modules/agent-lib-runtime/README.md)) |
