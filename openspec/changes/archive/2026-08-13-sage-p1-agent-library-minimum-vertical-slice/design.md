## Context

P1 在 P0 的版本和 Spike 结论上实现唯一 Agent Loop。其消费者会是短 Chat 与 Temporal Activity，因此公共契约必须独立于 Pi、HTTP、Temporal 和存储。

## Goals / Non-Goals

**Goals:** 交付可嵌入的有界 Run、稳定事件与错误、可取消/可预算的执行、checkpoint 引用语义及普通 Node.js Host 证据。

**Non-Goals:** 不接入 Fastify、数据库、Temporal、UI、RemoteAgentClient 或真实凭据后端。

## Decisions

- 将 `AgentRunSpec`、`AgentEvent`、`AgentRunOutcome`、`AgentError` 和 `HarnessPort` 定义为 schema-first v1 contracts，事件以每 Run 单调 `sequence` 作为唯一时间线排序键。
- `agent-lib` 只依赖 contracts 与 ports；`harness-pi` 是唯一 Pi SDK 依赖；`LocalAgentClient` 是 Host 到 library 的调用门面。此结构优于每个 Host 自建 loop。
- 在启动前检查 Harness 支持的 skill、事件、取消和 checkpoint 能力；不满足时返回稳定错误，绝不半执行。
- budget/deadline/cancel 在 loop 内统一仲裁；checkpoint 保存为引用而非供应商对象或敏感状态。

## Risks / Trade-offs

- [最小公共 schema 后续不足] → 使用兼容性/序列化测试与显式版本演进，避免泄漏 Pi 类型。
- [取消不即时] → 规定取消请求、已确认取消及超过 deadline 的事件/结果语义。
- [预算统计与 Harness 不同] → 以保守计数并暴露稳定的耗尽错误。

## Migration Plan

先创建 contracts 和 Node.js 示例 Host，再接 Harness 与 LocalAgentClient；五类终态 Run 通过才允许 P2。未发布的 v1 若需破坏性修改，先修改 architecture/contract decision 并重新跑兼容性测试。

## Open Questions

Pi Spike 确认的 session/resume 颗粒度、checkpoint 格式兼容期和 token 计量来源需在实现前写入 P0 结论。