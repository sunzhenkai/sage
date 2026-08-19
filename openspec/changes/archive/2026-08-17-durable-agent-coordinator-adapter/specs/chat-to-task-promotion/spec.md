## ADDED Requirements

### Requirement: Single-owner Chat to durable handoff
Promote persisted Chat Message为durable Task时，系统 SHALL 建立不可变association与可恢复handoff record，并在启动durable Attempt前以幂等control使相关interactive Run结束或暂停到安全边界。Handoff SHALL 只传immutable input/checkpoint refs、digests与稳定IDs，并 MUST 保证interactive与durable不会同时成为lifecycle owner。

#### Scenario: Successful owner handoff
- **WHEN** authorized user promotion的interactive Run仍active
- **THEN** 系统先取得source quiesce确认与cursor/checkpoint refs，再以唯一owner token启动durable Attempt，最终association标记为durable-owned

#### Scenario: Failure before source quiesce
- **WHEN** handoff在interactive Run结束或暂停确认前失败
- **THEN** interactive owner保持有效，系统不发送durable start且可幂等重试handoff

#### Scenario: Failure after source quiesce before start confirmation
- **WHEN** source已quiesced但durable start响应丢失
- **THEN** source不自动恢复，reconciler以同一owner token和start idempotency key确认或补发同一durable start，不创建第二owner

#### Scenario: Concurrent promotion and interactive continuation
- **WHEN** promotion与新的interactive continuation并发
- **THEN** 单调handoff/source cursor与owner CAS只允许一方推进；若promotion取得handoff所有权，interactive continuation被拒绝或等待

#### Scenario: Promotion payload boundary
- **WHEN** Chat promotion构造durable execution input
- **THEN** Coordinator只接收已admission的`AgentExecutionEnvelope`与immutable refs/digests，不接收消息正文、raw target、model配置或Chat Store对象
