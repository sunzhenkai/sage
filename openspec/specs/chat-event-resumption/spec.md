# chat-event-resumption Specification

## Purpose
TBD - created by archiving change sage-p3-short-chat-vertical-slice. Update Purpose after archive.
## Requirements
### Requirement: Sequence-based Chat SSE resumption

Chat API SHALL 以monotonic sequence持久化Timeline events，并 SHALL 从严格大于client提供的`afterSequence`处恢复SSE。Web从canonical session URL恢复时 SHALL 先确认session detail与status，加载其persisted events，再以latest durable sequence连接SSE并按sequence去重；detail/events为404时 SHALL进入recovery state且不得切换或创建其他session。

#### Scenario: Reconnect after interruption
- **WHEN** SSE client使用最后durably received sequence重连
- **THEN**它恰好接收每个更晚的persisted event，不重放更早event且不跳过后续event

#### Scenario: Empty catch-up
- **WHEN** `afterSequence`等于latest persisted sequence
- **THEN**API返回不重放historical event的open stream

#### Scenario: 从history URL恢复timeline
- **WHEN**用户通过history link、refresh或Back/Forward打开有效canonical session URL
- **THEN**Web加载该session的persisted events并从其latest durable sequence续接，不混入其他session事件

#### Scenario: Session在恢复前已删除
- **WHEN**session detail或events route对URL中的session返回404
- **THEN**Web停止SSE建立并显示recovery state，不自动POST创建替代session

### Requirement: 发送路径事件增量补拉

Web SHALL 在发送消息的 `POST /v1/chat/sessions/:id/messages` 返回 202 后，立即以当前 timeline 的最新 durable sequence 为 cursor 发起一次 `GET /v1/chat/sessions/:id/events?afterSequence=<cursor>` 增量补拉，并按既有 sequence 去重语义合并进 timeline state。该补拉 SHALL 不等待 SSE 推送，且 SHALL 与并发到达的 SSE 事件幂等合并（同一 sequence 只保留一份）。补拉失败 SHALL NOT 阻断或重置既有 SSE 订阅，也不得向用户展示误导性错误。

#### Scenario: SSE 停滞时自身消息即时可见

- **WHEN** 用户发送消息且 POST 返回 202，而 SSE 链路未推送任何新事件
- **THEN** Web 通过补拉使该用户消息与已持久化的后续事件出现在 timeline 中，顶部事件计数随之增长

#### Scenario: 补拉与 SSE 推送幂等合并

- **WHEN** 补拉返回的事件与 SSE 已推送的事件存在相同 sequence
- **THEN** timeline 中每个 sequence 只出现一次，且事件计数不因合并而重复增长

#### Scenario: 补拉失败不破坏既有订阅

- **WHEN** 补拉请求网络失败或返回非 2xx
- **THEN** Web 保持既有 SSE 订阅与已加载事件不变，不切换 session、不重置 timeline

### Requirement: Chat Timeline SSE 心跳

agent-api 的 chat timeline SSE 流 SHALL 以不超过 20 秒的间隔发送 SSE 注释帧（如 `: ping`）作为心跳。心跳帧 SHALL 对 `EventSource` 语义透明（不产生 message 事件、不改变事件序列），并 SHALL 可被客户端与中间代理用作链路活跃性诊断。心跳 SHALL NOT 影响 sequence 语义与断线续传行为。

#### Scenario: 空闲会话保持心跳

- **WHEN** 一个已连接的 timeline SSE 在超过 20 秒内没有任何 timeline 事件
- **THEN** 流上出现至少一个注释帧心跳，连接不因空闲被静默判定失活

#### Scenario: 心跳不产生可见事件

- **WHEN** 客户端收到心跳注释帧
- **THEN** timeline state 与事件计数不变，不出现空事件或解析错误
