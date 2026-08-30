# 图(diagrams/)

已用 `archify` 生成可交互 HTML。架构图（architecture）因节点密度较高，采用 `standard` 质量档；其余 diagram 类型采用 `showcase`。

| 图 | 类型 | 回答什么问题 | HTML |
|---|------|--------------|------|
| 系统上下文与信任边界 | architecture | Sage 在环境中的位置、邻接、责任切分 | [system-context.html](system-context.html) |
| 模块依赖图 | architecture | 模块间依赖方向 | [module-map.html](module-map.html) |
| 进程与部署拓扑 | architecture | Postgres/Temporal/MinIO/API/Worker/Web 关系 | [deployment-topology.html](deployment-topology.html) |
| Chat 短请求时序 | sequence | 浏览器 → agent-api → LocalAgentClient → Provider | [chat-short-run-sequence.html](chat-short-run-sequence.html) |
| 长请求 Temporal 提升时序 | sequence | agent-api → Task Router → Worker Activity → Agent Library | [chat-elevated-task-sequence.html](chat-elevated-task-sequence.html) |
| Release 准入工作流 | workflow | submit → compile-sign → check → registry → run | [release-admission-workflow.html](release-admission-workflow.html) |
| Effect Ledger 数据流 | dataflow | Effect → Ledger → Consumption → 计费 | [effect-ledger-dataflow.html](effect-ledger-dataflow.html) |
| Run 状态机 | lifecycle | `queued → running → awaiting_input → succeeded/failed/cancelled` | [agent-run-lifecycle.html](agent-run-lifecycle.html) |
| Schedule 定时触发时序（P8） | sequence | 创建控制面 → occurrence 触发 → 统一准入 → durable run → 回写/对账 | [schedule-trigger-run-sequence.html](schedule-trigger-run-sequence.html) |

> 注：`release-admission-workflow` 把原多个节点收敛为 `compile-sign` 与 `check` 两个语义节点，以保持工作流可读性。
