# ai-app-self-contained-runs-driver — Design

## Context

本 change 是 taskflow driver：自身不改代码、无 spec 增量（`skip_specs: true`），只编排六个子 change 完成「AI App 自闭环运行」重构。决策级设计已在 propose 前完成，暂存于本 change `design/` 目录（taskflow 惯例），归档时晋升 `docs/design/ai-app/` 与 `docs/adr/`。

## Goals / Non-Goals

**Goals:**
- 六个子 change 的拆分粒度、依赖排序与并行边界固定下来，apply 阶段不再做拆分决策。
- 在途变更（`package-run-input-snapshots`、`sage-p8-unattended-schedule-pilot`）的吸收/修订关系落成可执行条目。

**Non-Goals:**
- 不在 driver 层重复子 change 的技术设计（见 `design/` 各篇）。
- 不实施任何代码。

## Decisions

| 决策 | 内容 | 依据 |
|---|---|---|
| D1 拆分 | 六子变更 A manifest-v2 / B input-binding / C output-contract / D schedule-binding / E model-route / F examples-ui | `design/phasing-and-migration.md` §2 |
| D2 排序 | D 依赖 A+B；F 最后收尾；A/C/E 契约冻结后可并行 | 同上 §2 排序约束 |
| D3 吸收 | `package-run-input-snapshots` 内容并入 B（更名 dataSources、新增 markMissing），B 完成后归档该 change | 同上 §3 |
| D4 P8 修订 | D 只修订 P8 的 planning artifacts（schedule 绑定 task+params），不实施调度面；P8 实施排期晚于 A+B | 同上 §3 |
| D5 兼容策略 | 渐进方案 A（v2 全可选 + 隐式单任务 + input 字段 410 窗口）；v1 golden 钉死 | 同上 §1 对比与推荐 |

## Risks / Trade-offs

- [子变更契约漂移] → 子 change specs 均以 `design/app-task-run-model.md` §3 契约草案为唯一来源，apply 阶段不改语义。
- [P8 排期耦合] → D 的 tasks 含「确认 P8 排序约束已记录」检查项；不满足时保持未勾并写验证记录。
