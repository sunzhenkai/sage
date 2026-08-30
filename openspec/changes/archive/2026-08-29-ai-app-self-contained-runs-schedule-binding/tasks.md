# ai-app-self-contained-runs-schedule-binding — Tasks

## 1. P8 planning artifacts 修订

- [x] 1.1 修订 P8 `proposal.md`：Schedule 契约段改为绑定 `{releaseRef, task, params(固化), releasePolicy: pinned|follow}`，触发接线明确「以固化 params 走既有包运行准入（`package-run-input-resolution` 语义）」
- [x] 1.2 修订 P8 `design.md`：dispatcher workflow 输入含 task 与固化 params；occurrence 幂等键纳入 task+params；follow 不兼容（新 Release 缺同名 Task 或 params 不合法）时触发稳定失败并路由告警，不静默跳过
- [x] 1.3 修订 P8 `specs/ai-app-schedule-plane/spec.md`：绑定/创建时校验/触发输入来源/follow 失败语义的场景增量
- [x] 1.4 `openspec validate sage-p8-unattended-schedule-pilot --strict` 通过（修订后）

## 2. 排序与记录

- [x] 2.1 确认前置：`ai-app-self-contained-runs-manifest-v2` 与 `…-input-binding` 已全勾（driver 2.1/2.2），不满足则本项保持未勾并在 driver 验证记录写明
- [x] 2.2 在 P8 proposal 的假设/依赖段记录排序约束（P8 实施晚于 A+B 完成）
