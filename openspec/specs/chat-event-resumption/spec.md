# chat-event-resumption Specification

## Purpose
TBD - created by archiving change sage-p3-short-chat-vertical-slice. Update Purpose after archive.
## Requirements
### Requirement: Sequence-based Chat SSE resumption

Chat API SHALL 以monotonic sequence持久化Timeline events，并 SHALL 从严格大于client提供的`afterSequence`处恢复SSE。

#### Scenario: Reconnect after interruption
- **WHEN** SSE client使用最后durably received sequence重连
- **THEN**它恰好接收每个更晚的persisted event，不重放更早event且不跳过后续event

#### Scenario: Empty catch-up
- **WHEN** `afterSequence`等于latest persisted sequence
- **THEN**API返回不重放historical event的open stream



### Requirement: Chat Timeline SSE 心跳

agent-api 的 chat timeline SSE 流 SHALL 以不超过 20 秒的间隔发送 SSE 注释帧（如 `: ping`）作为心跳。心跳帧 SHALL 对 `EventSource` 语义透明（不产生 message 事件、不改变事件序列），并 SHALL 可被客户端与中间代理用作链路活跃性诊断。心跳 SHALL NOT 影响 sequence 语义与断线续传行为。

#### Scenario: 空闲会话保持心跳

- **WHEN** 一个已连接的 timeline SSE 在超过 20 秒内没有任何 timeline 事件
- **THEN** 流上出现至少一个注释帧心跳，连接不因空闲被静默判定失活

#### Scenario: 心跳不产生可见事件

- **WHEN** 客户端收到心跳注释帧
- **THEN** timeline state 与事件计数不变，不出现空事件或解析错误
