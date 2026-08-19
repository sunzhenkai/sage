## MODIFIED Requirements

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
