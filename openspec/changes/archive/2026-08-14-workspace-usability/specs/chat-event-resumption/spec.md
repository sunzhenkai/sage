## MODIFIED Requirements

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
