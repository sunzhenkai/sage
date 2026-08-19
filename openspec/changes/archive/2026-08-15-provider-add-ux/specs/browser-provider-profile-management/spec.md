## MODIFIED Requirements

### Requirement: 显式 create/edit/Cancel 状态机
Profile editor SHALL使用`idle|creating|editing(profileId)|saving` discriminated state，不得使用`activeId='new-provider'` sentinel或首profile fallback。Create SHALL以accessible dialog呈现，并按Provider选择、Model选择、名称/Base URL/API key与保存的顺序组织新增流程。Create Cancel SHALL丢弃draft并恢复之前selection/idle；创建保存成功 SHALL关闭dialog并将新profile加入列表；Edit Cancel SHALL恢复最后persisted profile；display name一旦被用户编辑 SHALL不再被selector覆盖。

#### Scenario: 空列表创建profile
- **WHEN**external profile list为空且用户选择Add provider
- **THEN**editor展示独立空draft，不被任何default或System runtime记录回填

#### Scenario: Add provider opens dialog
- **WHEN**用户点击Add provider
- **THEN**页面打开`role="dialog"`且`aria-modal="true"`的新增窗口，首个选择步骤是Provider combobox，列表中不创建临时profile

#### Scenario: Provider selection defaults editable fields
- **WHEN**用户在新增dialog选择Provider
- **THEN**系统写入provider ID/name、清除旧model与source-derived URL，并在名称未被用户编辑时将名称填为Provider name；Catalog提供的HTTPS URL可被用户修改

#### Scenario: Create save closes dialog
- **WHEN**用户选择合法Provider和Model、输入必需字段并保存
- **THEN**profile写入既有browser-local metadata，API key只进入当前tab secret，dialog关闭且列表显示新profile

#### Scenario: Create Cancel
- **WHEN**用户在creating状态修改字段后点击Cancel或Escape
- **THEN**dialog关闭、未保存draft被丢弃且列表和localStorage保持不变

#### Scenario: Edit Cancel
- **WHEN**用户编辑已存在profile后Cancel
- **THEN**所有字段恢复为最后persisted值

#### Scenario: 用户命名优先
- **WHEN**用户手工编辑display name后再选择model
- **THEN**selector不覆盖该name；未dirty时才默认`${providerName} / ${modelName}`

#### Scenario: User name wins
- **WHEN**用户手工编辑display name后再选择Provider或Model
- **THEN**selector不覆盖用户输入的name

### Requirement: Provider profile v2 storage 与 secret边界
Browser SHALL将合法`ProviderProfileV2` metadata写入`sage.provider-profiles.v2`，包含stable id、name、enabled、adapterKind、provider/model metadata、可选base URL、`baseUrlSource`、catalog snapshot provenance与updatedAt。Browser SHALL NOT将API key、token或`apiKeyConfigured`持久化到profile/localStorage/PostgreSQL；secret presence SHALL只从当前tab的`sessionStorage`实时派生，保存后 SHALL清空React secret draft。连接检测 SHALL只在用户显式点击时读取当前tab secret并发送本次请求，检测结果不得持久化为profile metadata。

#### Scenario: 当前tab secret
- **WHEN**用户为profile保存API key
- **THEN**key只进入该profile稳定id对应的`sessionStorage`项，localStorage/profile/catalog与日志均不含key或configured flag

#### Scenario: 新tab不误报secret
- **WHEN**用户在没有原sessionStorage的新tab打开同一localStorage profile
- **THEN**UI不声称API key已配置

#### Scenario: Untrusted localStorage
- **WHEN**v2 storage包含unknown、malformed或越界item
- **THEN**loader严格校验并隔离非法item或显示recoverable error，不让整页崩溃且不覆盖原值

#### Scenario: Connection check keeps secret isolated
- **WHEN**用户点击已保存profile的连接检测图标
- **THEN**请求最多包含当前profile的adapter/base URL/model和当前tab API key，localStorage不出现key、检测结果或`apiKeyConfigured`

#### Scenario: Connection result is redacted
- **WHEN**Provider返回401、错误body或包含敏感信息的失败
- **THEN**UI只展示稳定非敏感状态/消息，API response、notice和日志均不回显API key或上游body

### Requirement: Enabled intent 与 profile完成度
`enabled` SHALL只表示用户对未来profile picker可用性的意图，不表示runtime正在执行。Derived status SHALL为Disabled、Incomplete或Available metadata。Metadata完整的`unassigned` profile可enabled但仍不可执行；URL-based adapter缺少合法HTTPS base URL时 SHALL拒绝`enabled=true`保存并聚焦Base URL，同时 SHALL允许以`enabled=false`保存draft。Provider connection check SHALL不改变`enabled`或Local Pi runtime状态。

#### Scenario: URL adapter不完整
- **WHEN**`openai-compatible`或`anthropic` profile的base URL缺失或非法且用户尝试enabled保存
- **THEN**Save失败、Base URL获得focus，profile不被错误标记Available

#### Scenario: Disabled draft
- **WHEN**同一不完整profile被用户明确disabled后保存
- **THEN**draft成功持久化为Disabled并保留`baseUrlSource='none'`

#### Scenario: Unassigned metadata
- **WHEN**provider/model metadata完整、adapterKind为`unassigned`且enabled
- **THEN**UI显示Available metadata并明确`executionAvailable=false`

#### Scenario: Check does not activate runtime
- **WHEN**连接检测返回connected
- **THEN**profile仅显示检测成功状态，`enabled`、Chat/Task payload与Local PiHarness assembly不改变
