# chat-to-task-promotion Specification

## Purpose
TBD - created by archiving change sage-p6-chat-task-reconciliation-and-e2e. Update Purpose after archive.
## Requirements
### Requirement: Traceable Chat to durable Task promotion

系统 SHALL 允许authorized user显式将eligible persisted Chat Message promote为Task，创建immutable Message-to-Task association与Task Card，并通过trusted Router路由Task。Text timeline payload SHALL 以可选`promotionEligibility: 'explicit'|'none'`表达资源级展示能力：新persisted user text为`explicit`，assistant text为`none`，历史缺失字段按`none` fail-closed。该字段 SHALL NOT替代server对persisted user message和principal的最终授权。PostgreSQL SHALL以`BEFORE UPDATE OR DELETE` trigger约束association仅允许pending-to-routed transition与idempotent no-op、默认拒绝DELETE，并 SHALL对promotion audit强制append-only。

#### Scenario: Successful explicit promotion
- **WHEN**authorized user promote一个`promotionEligibility='explicit'`的persisted Chat Message
- **THEN**UI展示linked Task Card，且Task通过Router使用其target snapshot创建

#### Scenario: Restricted rule promotion
- **WHEN** configured automatic promotion rule适用
- **THEN**系统记录rule identity与reason，且不允许model-provided raw target configuration

#### Scenario: Assistant message不显示无效CTA
- **WHEN**timeline text来自assistant或`promotionEligibility='none'`
- **THEN**UI不显示Promote to Task action

#### Scenario: Legacy event fail-closed
- **WHEN**历史text event具有`messageId`但缺少`promotionEligibility`
- **THEN**UI按`none`处理且不显示promotion CTA

#### Scenario: Server authorization保持权威
- **WHEN**client伪造eligibility或尝试promote非persisted user message
- **THEN**server拒绝请求且不创建association或Task

#### Scenario: Promotion payload保持严格
- **WHEN**client提交promotion
- **THEN**body只允许既有`mode`、`taskType`、`ruleId`字段，并拒绝provider、model、profile、base URL、target、endpoint、namespace、actor或roles

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

### Requirement: Promotion 成功反馈提供任务入口

Web 在 promote to Task 成功受理后展示的成功反馈 SHALL 包含到达所创建/关联任务的操作入口（链接或按钮），使无需离开当前会话即可查看任务执行情况。该入口 SHALL 指向本次 promotion 返回的任务标识对应的任务详情；后端响应未携带任务标识时，SHALL 至少提供到达该会话关联任务工作台的入口。此要求不改变 promotion 的授权与创建语义。

#### Scenario: 成功提示可跳转任务详情

- **WHEN** 用户对一个 `promotionEligibility='explicit'` 的消息执行 Promote to Task 且后端受理成功
- **THEN** 成功提示中提供指向新建任务详情的操作入口，点击后到达该任务的详情视图

#### Scenario: 与既有运行入口模式一致

- **WHEN** 同一页面中 Start run 成功提示提供 "View run" 入口
- **THEN** promotion 成功提示的任务入口在形态与位置上与之一致，不引入新的交互范式
