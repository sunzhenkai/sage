## ADDED Requirements

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
