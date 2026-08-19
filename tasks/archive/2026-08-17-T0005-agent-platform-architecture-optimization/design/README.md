# T0005 设计文档

- **任务**：T0005 — 优化 Sage 通用 Agent 平台架构
- **设计状态**：已暂存，待 `task-propose`
- **设计范围**：Agent-first 通用 Agent 平台终版逻辑架构、核心契约、状态权威、失败语义与增量迁移
- **阶段边界**：本目录是 `task-design` 产物；本阶段不写实现代码、不创建 OpenSpec change，也不晋升正式设计文档

## 文档索引

| 文档 | 说明 | 状态 |
|------|------|------|
| [`generic-agent-platform-final-architecture.md`](./generic-agent-platform-final-architecture.md) | 终版系统架构主设计；包含四个方案及权衡、推荐架构、架构图、核心契约、authority matrix、安全与失败语义、Phase 0–4 迁移和未决问题 | 已暂存 |

## 归档落点表

| 文档 | 类型 | 目标仓 | 归档落点 |
|------|------|--------|----------|
| `design/generic-agent-platform-final-architecture.md` | design | `.` | `docs/design/_cross/generic-agent-platform-final-architecture.md` |

## 归档说明

- 正式落点 `docs/design/_cross/generic-agent-platform-final-architecture.md` 当前已有一份目标架构参考；它是本次任务设计的基线来源。
- `task-archive` 时应依据本目录快照对正式文档做**合并更新/校准**，不得创建同主题重复文档。
- 在新 System Model、Runtime DSL 与 Formal Architecture Review 通过 Gate 前，正式设计状态保持 `Proposed final architecture baseline`。
- 本阶段不会写入上述正式落点；本目录原件将在任务归档后作为设计快照保留。

## 后续

- 下一步：`/task-propose T0005`
- 提案应以主设计中的推荐方案、架构不变量和 Phase 0–4 依赖顺序拆分一个或多个可独立验收、回滚的 OpenSpec change。
- 环境与产品 Owner 未决项保留在主设计“已决定与开放问题”中，不与推荐方案混写。
