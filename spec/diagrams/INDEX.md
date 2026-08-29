# 图(diagrams/)

本镜像目前**未生成 archify HTML**。架构图先以 `docs/design/README.md` 中的目标态 ASCII 图为准;模块边界、依赖方向、运行时拓扑以本文档表格为准。

| 候选图 | 类型 | 回答什么问题 | 状态 |
|--------|------|--------------|------|
| 系统上下文与信任边界 | architecture | Sage 在环境中的位置、邻接、责任切 | 候选,未生成 |
| 模块依赖图 | architecture | 模块间依赖方向 | 候选,未生成 |
| 进程与部署拓扑 | architecture | Postgres/Temporal/MinIO/API/Worker/Web 关系 | 候选,未生成 |
| Chat 短请求时序 | sequence | 浏览器 → agent-api → LocalAgentClient → Provider | 候选,未生成 |
| 长请求 Temporal 提升时序 | sequence | agent-api → Task Router → Worker Activity → Agent Library | 候选,未生成 |
| Release 准入工作流 | workflow | submit → compile → admission → registry → run | 候选,未生成 |
| Effect Ledger 数据流 | dataflow | Effect → Ledger → Consumption → 计费 | 候选,未生成 |
| Run 状态机 | lifecycle | `queued → running → awaiting_input → succeeded/failed/cancelled` | 候选,未生成 |

> 何时画:表格说不清时再委托 `archify` 生成 HTML。本轮 build 采用精简模式,优先级低于金字塔/投影/切面。
