# Agent Run v1 语义

- `sequence` 从 1 开始，在单个 Run 内严格递增；消费者只用 `(run_id, sequence)` 重建时间线，`occurredAt` 不参与排序。
- 每个已启动 Run 只有一个终态：`succeeded`、`failed`、`cancelled`、`deadline_exceeded`、`budget_exhausted` 或 `paused`。
- Harness capability 在 `run.started` 和任何模型/Tool 调用前验证；缺失时仅产生稳定 `HARNESS_CAPABILITY_MISSING` 失败。
- `cancel()` 先发 `run.cancel.requested`，再传播 AbortSignal；最终确认状态为 `cancelled`。deadline 使用同一中止路径，但稳定状态为 `deadline_exceeded`。
- turn/tool/token 使用保守计数。达到 turn 上限且未完成，或 Harness 报告的 tool/token 使用超过剩余额度时，返回对应稳定 budget error；不会开始下一 turn。
- pause 只能发生在 Harness 返回的安全 turn 边界。checkpoint 是 `checkpoint://` 引用；事件、Outcome、Client 均不携带 Pi Session、transcript、Secret 或 checkpoint payload。
- `LocalAgentClient` 原样暴露 Library 的 event stream、cancel 和 Outcome，不解释或转换 checkpoint。
