# ai-app-self-contained-runs-schedule-binding

## Why

P8（`sage-p8-unattended-schedule-pilot`）的调度契约缺少输入来源与入口选择：触发器只带 scheduleId + occurrenceId，隐含「空输入运行」，也无法表达「定时执行哪个 Task」。若不修订，调度面将建立在任务级现场输入的缺陷地基上（driver ADR 与 `design/phasing-and-migration.md` §3 的排序约束：本变更须在 manifest-v2 与 input-binding 之后、P8 实施之前完成）。

## What Changes

- 修订 P8 的 planning artifacts（proposal/design/specs，P8 未实施、纯规划修订）：
  - Schedule 契约绑定 `{ releaseRef, task, params(固化), releasePolicy: pinned | follow }`；创建 schedule 时按当时 Release 校验 task 存在与 params 合法性。
  - occurrence 触发 = 以固化 params 走既有 `POST /v1/releases/:id/runs` 同一准入路径（含 dataSources 获取与失败语义），不另设调度专属输入通道。
  - `follow` 策略下新 Release 不含同名 Task 或 params 不兼容时，该次触发稳定失败并进 P8 告警路由，不静默跳过。
- 本 change 自身不修改系统行为（skip_specs：spec 增量归 P8 的 `ai-app-schedule-plane` 能力，由 P8 实施落地）；交付物是修订后的 P8 规划工件 + 排序约束记录。

## Capabilities

### New Capabilities

（无——本 change 无 spec 增量，`.openspec.yaml` 已设 `skip_specs: true`；调度面 spec 增量在 P8 自己的变更内）

### Modified Capabilities

（无）

## Impact

- `openspec/changes/sage-p8-unattended-schedule-pilot/`：proposal.md（What Changes 的 Schedule 契约段）、design.md（dispatcher 输入与幂等键）、specs/ai-app-schedule-plane/spec.md（绑定与触发场景）。
- driver `ai-app-self-contained-runs-driver`：排序约束已写入其 tasks（2.4 前置 2.1+2.2）。
- 不改任何运行时代码。
