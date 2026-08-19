# browser-provider-profile-management Specification

## Purpose
TBD - synchronized from change workspace-usability. Update Purpose when the capability is refined.
## Requirements
### Requirement: System runtime 与 Provider profile 分离
Web SHALL将Local Pi作为唯一、只读、不可关闭的`System runtime · In use`展示，并 SHALL将external Provider profiles仅作为browser-local metadata。Profile SHALL NOT显示Active、Running或In use，选择/保存profile SHALL NOT改变`createLocalAgentClient()`、PiHarness、Temporal或Chat/Task执行。

#### Scenario: Local Pi固定运行时
- **WHEN**用户打开Providers页面
- **THEN**Local Pi只出现在System runtime区域且不可由profile toggle关闭

#### Scenario: External profile不驱动执行
- **WHEN**用户创建、启用或选择external profile
- **THEN**Local PiHarness仍是实际runtime，Chat/Task请求与server assembly不改变

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

### Requirement: Catalog-assisted provider/model selector
Profile editor SHALL提供provider与provider-scoped model可搜索combobox，使用250ms debounce、AbortController、request token、snapshot match与ARIA keyboard semantics。Provider变化 SHALL原子清除旧model与source-derived base URL；manual URL默认清除，只有用户显式确认才保留。Deprecated/legacy model SHALL默认隐藏并可显式包含。

#### Scenario: 快速provider query
- **WHEN**用户在前一query完成前继续输入
- **THEN**editor abort旧request，并只接受与current token和active snapshot匹配的response

#### Scenario: Provider变化清理依赖字段
- **WHEN**用户从provider A切换到provider B
- **THEN**旧model id/name与model/provider source URL被清除，manual URL不会无提示跨provider保留

#### Scenario: Snapshot在选择期间变化
- **WHEN**Catalog cursor返回409或新page使用不同snapshot
- **THEN**selector重载新列表，不静默改写已选择值，并提示Catalog updated

#### Scenario: Keyboard和规模
- **WHEN**用户以键盘搜索185+ providers或6,000+ models
- **THEN**combobox支持上下、Enter、Escape与listbox/option ARIA，且不向browser下载raw snapshot

### Requirement: Source-only base URL mapping 与 provenance
选择provider/model SHALL填充其ID与name，并从同一`CatalogPage`保存`snapshotId/activeSince`。`effectiveBaseUrl` SHALL只采用合法`https:`的`model.provider.api ?? provider.api`；不存在时 SHALL使用`baseUrlSource='none'`且不得猜测endpoint或根据`npm`推断adapter。用户编辑URL SHALL设置`manual`，已保存profile SHALL不因daily sync自动变化。

#### Scenario: Model URL覆盖provider URL
- **WHEN**选择的model提供合法override且provider也提供URL
- **THEN**profile使用model URL并记录`baseUrlSource='model'`与同一page provenance

#### Scenario: 仅provider URL
- **WHEN**model无合法override但provider有合法HTTPS API
- **THEN**profile使用provider URL并记录`baseUrlSource='provider'`

#### Scenario: Source缺少URL
- **WHEN**model与provider均没有合法API URL
- **THEN**profile可记录metadata与`baseUrlSource='none'`，UI明确source未发布URL且不猜测OpenAI、Anthropic或其他endpoint

#### Scenario: Manual URL与catalog更新
- **WHEN**用户手工输入合法HTTPS URL后Catalog每日更新
- **THEN**profile保留manual值与`baseUrlSource='manual'`，只有用户显式选择Use catalog value才替换

### Requirement: Enabled intent 与 profile完成度
`enabled` SHALL只表示用户对未来profile picker可用性的意图，不表示runtime正在执行。Derived status SHALL为Disabled、Incomplete或Available metadata。Metadata完整的`unassigned` profile可enabled但仍不可执行；URL-based adapter缺少合法HTTPS base URL时 SHALL拒绝`enabled=true`保存并聚焦Base URL，同时 SHALL允许以`enabled=false`保存draft。Catalog SHALL NOT后台改写enabled。

#### Scenario: URL adapter不完整
- **WHEN**`openai-compatible`或`anthropic` profile的base URL缺失或非法且用户尝试enabled保存
- **THEN**Save失败、Base URL获得focus，profile不被错误标记Available

#### Scenario: Disabled draft
- **WHEN**同一不完整profile被用户明确disabled后保存
- **THEN**draft成功持久化为Disabled并保留`baseUrlSource='none'`

#### Scenario: Unassigned metadata
- **WHEN**provider/model metadata完整、adapterKind为`unassigned`且enabled
- **THEN**UI显示Available metadata并明确`executionAvailable=false`

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
- **WHEN**用户在creating状态修改字段后Cancel或Escape
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

### Requirement: 安全且可回滚的 v1 到 v2 migration
Loader SHALL优先使用合法v2；仅当v2不存在时读取v1。所有legacy `kind='local'`记录 SHALL隔离且不得迁移为external profile，Local Pi只由System runtime生成。其他profile SHALL保留stable id/name/updatedAt，将支持的kind映射adapterKind、合法URL标为manual；若legacy enabled不满足新规则 SHALL降为false并记录非敏感warning。Migration SHALL保留v1 key、不迁移`apiKeyConfigured`，全新browser SHALL从空external list开始。

#### Scenario: 所有legacy local记录隔离
- **WHEN**v1包含任意id且`kind='local'`的一个或多个记录
- **THEN**这些记录均不进入v2 external list，UI最多显示安全migration warning且只呈现一个System runtime

#### Scenario: Incomplete legacy enabled降级
- **WHEN**legacy URL adapter为enabled但迁移后缺少合法base URL或metadata
- **THEN**v2记录以`enabled=false`保存并记录非敏感warning

#### Scenario: Malformed v1不覆盖
- **WHEN**v1 storage无法通过validation
- **THEN**loader保留原key、显示recoverable error，并允许用户从空draft恢复而不伪造数据

#### Scenario: Fresh browser无默认external profile
- **WHEN**v1和v2均未真实持久化
- **THEN**external profile list为空，只有独立System runtime可见

### Requirement: Workspace payload 与 secret隔离

Provider/profile/catalog metadata SHALL只影响配置UI与用户显式选择的 Chat 运行时，不得加入Task create/signal/cancel/retry payload；Task 相关schema SHALL继续拒绝additional properties。Chat submit与retry payload SHALL允许可选的ephemeral provider route（adapterKind、HTTPS baseUrl、modelId与当前tab API key），且仅当次Run在内存中使用：SHALL NOT持久化route或key到localStorage、sessionStorage以外的存储、PostgreSQL或日志。Browser SHALL不把API key转发到Catalog sync或Pi harness以外的任何端点；未选择profile时Chat payload SHALL不含任何provider字段。

#### Scenario: Chat submit 携带显式 route

- **WHEN**用户选择了executionAvailable profile且当前tab存在secret后发送Chat消息
- **THEN**请求body仅包含parts与该profile对应的provider route（adapter/base URL/model/key），服务端不持久化route

#### Scenario: 未选择 profile 的 Chat payload

- **WHEN**用户使用默认本地运行时发送消息、执行promotion或Task controls
- **THEN**捕获的request body不含provider、model、profile、base URL、API key，实际runtime仍为本地Pi harness

#### Scenario: Chat与Task boundary negative test

- **WHEN**用户选择了含provider、model、base URL和secret的profile后执行promotion与Task controls（以及未选择profile时的Chat提交）
- **THEN**捕获的request body不含provider、model、profile、base URL、API key、target、actor或roles；只有用户显式选择的Chat submit/retry例外地携带provider route，实际Task runtime仍为本地Pi

### Requirement: Provider 新增弹窗的键盘与焦点管理

Profile editor 的 creating dialog SHALL支持 `Esc` 键关闭与点击蒙层关闭；关闭后焦点 SHALL返回到触发「Add provider」按钮。Dialog 打开时首个焦点仍落在 Provider combobox，但 Escape 不再被内部 combobox 独占。

#### Scenario: Esc 关闭新增弹窗
- **WHEN** 用户处于 creating dialog 且未展开 combobox 选项或按 Esc 时选项已关闭
- **THEN** dialog 关闭并回到 idle 状态

#### Scenario: 点击蒙层关闭新增弹窗
- **WHEN** 用户在 creating dialog 点击灰色蒙层
- **THEN** dialog 关闭且未保存 draft 被丢弃

#### Scenario: 焦点返回触发按钮
- **WHEN** 用户通过键盘激活 Add provider，随后 Esc 关闭 dialog
- **THEN** 焦点回到 Add provider 按钮，便于连续键盘操作

### Requirement: Provider 保存与目录同步提示的本地化

保存 profile 或触发 catalog sync 后，系统 SHALL使用 `web-interface-localization` 资源中的翻译键呈现成功/状态提示，SHALL NOT写死英文文案。`zh-CN` 与 `en` 界面在相同操作后均应展示对应语言提示。

#### Scenario: 中文界面保存 Provider
- **WHEN** 用户在 `zh-CN` 界面成功保存 profile
- **THEN** 提示使用中文资源，不显示英文 "saved as browser-local metadata"

#### Scenario: 英文界面同步目录
- **WHEN** 用户在 `en` 界面触发 catalog sync 并返回状态
- **THEN** 提示使用英文资源，且保留 attemptId 等动态信息

