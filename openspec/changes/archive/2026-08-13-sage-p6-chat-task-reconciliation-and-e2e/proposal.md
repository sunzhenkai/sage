## Why

MVP 的 Chat 与可靠 Task 链路必须汇合为用户可理解的长任务体验，同时可检测和修复 Temporal History 与产品投影的滞后。否则用户既无法持续查看长任务，也无法辨识状态是否过期。

## What Changes

- 支持显式及受限规则 Chat→Task 提升，并将原 Chat Message 关联为 Task Card。
- 提供 Task 列表、详情、Timeline、Signal、Cancel、Retry、Artifact 的 UI。
- 构建 TaskEvent/AgentEvent 投影、`projection_updated_at` 和 stale 状态表达。
- 以固化 Target Snapshot 查询 Temporal、对账并修复投影，保留修复审计。
- 完成端到端 correlation、Dashboard、关键告警、E2E 与故障注入证据。

## Capabilities

### New Capabilities
- `chat-to-task-promotion`: 从 Chat 明确提升为可靠 Task 并可追溯关联的用户流程。
- `task-operations-interface`: 查看与控制 Task Timeline、Artifact、Signal、Cancel、Retry 的 UI。
- `task-projection-reconciliation`: 识别、表达并依据 Temporal 执行事实修复滞后产品投影。
- `mvp-end-to-end-resilience`: 跨 Chat、Router、Worker、Store 与 Artifact 的关联观测和降级验证。

### Modified Capabilities

- 无。

## Impact

影响 Chat、Task、Router、projection、UI、可观测性和 E2E suites。它不增加 Chat 分支/协作、Schedule UI、自动跨 Cluster 迁移、Remote Binding 或多 Agent DAG。