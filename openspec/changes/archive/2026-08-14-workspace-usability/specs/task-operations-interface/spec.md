## MODIFIED Requirements

### Requirement: Snapshot-bound Task operations interface
Task UI SHALL 展示Task list、detail、Timeline、Artifact references与current projection freshness，并 SHALL通过snapshot-bound services提供authorized Signal、Cancel与Retry。Local runtime SHALL通过API composition root和使用固定local Namespace/Task Queue的真实Temporal Worker暴露这些operation，且不得接受request-side target override。Task row、Chat Task Card和direct URL SHALL使用native canonical `?view=tasks&task=<id>` link并保留可用的`session`；一次semantic activation SHALL只加载一组detail/events/artifacts，旧response不得覆盖新URL。

#### Scenario: User cancels a Task
- **WHEN**authorized user在Task detail选择Cancel
- **THEN**service解析stored Target Snapshot并向该target发送cancellation

#### Scenario: Stale projection presentation
- **WHEN**Task projection超过configured freshness threshold
- **THEN**UI将其标记为stale并展示最后`projection_updated_at`值

#### Scenario: Local promotion reaches a Worker
- **WHEN**authenticated local principal promote一个persisted Chat Message且local stack healthy
- **THEN**API routing持久化immutable target snapshot，fixed local Worker完成Task，且不接受endpoint、Namespace或Task Queue override

#### Scenario: Native Task detail navigation
- **WHEN**用户通过Task row、Chat Task Card、direct URL、refresh或Back/Forward打开Task
- **THEN**browser使用canonical native link恢复相同Task detail，并保留来源session而不依赖隐藏component state

#### Scenario: 单次activation只加载一组详情
- **WHEN**用户以鼠标或键盘激活一个Task row
- **THEN**唯一anchor触发一次navigation，页面只发起一组Task detail、events与artifacts请求

#### Scenario: 快速切换Task
- **WHEN**用户在前一组详情请求完成前打开另一个Task URL
- **THEN**UI abort或作废旧request token，且只有与current token和taskId匹配的一组数据可commit

#### Scenario: Control操作后的刷新
- **WHEN**Signal、Cancel或Retry成功
- **THEN**UI发起一个新的详情request group与list refresh，busy期间重复control为no-op

#### Scenario: 390px关键状态可见
- **WHEN**Task list在`390×844` viewport渲染
- **THEN**每行仍可见Task ID、execution status与projection freshness，且页面无横向溢出

#### Scenario: Task payload boundary
- **WHEN**client执行Task create、signal、cancel或retry
- **THEN**strict schema拒绝provider、model、profile、base URL、API key、target、endpoint、namespace、actor或roles字段
