## Why

Chat 与可靠 Task 都需要同一个、可被普通 Node.js Host 嵌入的 Agent Loop。先交付其最小有界纵切，才能防止应用层和 Worker 各自复制不同语义的执行循环。

## What Changes

- 定义并冻结 v1 `AgentRunSpec`、`AgentEvent`、`AgentRunOutcome`、`AgentError` 与 `HarnessPort` 公共契约。
- 实现 `agent-contracts`、`agent-lib`、`harness-pi`、`agent-client` 及 `LocalAgentClient`。
- 支持显式低风险只读 Skill/Tool、deadline、取消、turn/tool/token 预算、单调事件 sequence、暂停和 checkpoint 引用。
- 在启动前校验 Harness 能力，并通过普通 Node.js 示例 Host 验证成功、失败、取消、超时与预算耗尽。

## Capabilities

### New Capabilities
- `embeddable-agent-run`: 与 Host 无关、事件可重放且有资源边界的 Agent Run 公共行为。
- `pi-harness-adapter`: 仅由 Pi Harness 承载的 Pi SDK 适配与启动前能力校验。
- `local-agent-client`: Chat 和 Worker 可共同使用的本地 Agent Library 调用边界。

### Modified Capabilities

- 无。

## Impact

新增 Agent Library packages、契约 schema 和示例 Host。公共 API、schema 和依赖树不得泄漏 Pi、Temporal、Fastify、数据库或 UI 类型；不接入 HTTP、持久化或 Temporal。