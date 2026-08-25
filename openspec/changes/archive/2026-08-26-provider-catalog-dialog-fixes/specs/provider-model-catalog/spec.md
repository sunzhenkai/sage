## MODIFIED Requirements

### Requirement: Tolerant validation 与 whitelist projection
Ingest SHALL要求root为object，provider/model的key、id、非空name与models结构合法且相互一致；已使用字段的非法类型/长度 SHALL整批拒绝，未知字段 SHALL保留在raw JSONB但不进入public contract。只有可解析的`https:` URL SHALL进入projection；model的`release_date`字段合法时（bounded `YYYY-MM-DD`或月份精度`YYYY-MM`日期字符串，原样透传不归一化）SHALL进入projection为`releaseDate`，存在但类型/格式非法时 SHALL整批拒绝，缺失时 SHALL不产生该字段。browser SHALL只接收bounded whitelist provider/model pages，不接收raw snapshot。

#### Scenario: Unknown upstream fields
- **WHEN**payload增加未知但不影响required projection的字段
- **THEN**validation接受payload、raw snapshot保留字段，public response保持schema稳定

#### Scenario: Critical schema drift
- **WHEN**provider/model required id、name、map key或类型无效
- **THEN**整批snapshot被拒绝且旧active保持不变

#### Scenario: URL projection
- **WHEN**model override URL与provider URL均存在
- **THEN**`effectiveBaseUrl`使用有效的model `provider.api`，否则使用有效provider `api`，非法或非HTTPS URL不进入projection

#### Scenario: release_date projection
- **WHEN**model携带合法`YYYY-MM-DD`或`YYYY-MM`格式的`release_date`
- **THEN**该model的projection携带对应`releaseDate`（月份精度原样保留）；字段缺失的model不带`releaseDate`且payload整体仍被接受

#### Scenario: release_date 非法整批拒绝
- **WHEN**任一model的`release_date`存在但非字符串、超长或不符合`YYYY-MM-DD`与`YYYY-MM`任一格式
- **THEN**整批snapshot被拒绝且旧active保持不变，不进入projection

### Requirement: Catalog read 与 status API
系统 SHALL提供authenticated `GET /v1/provider-catalog/status`、`GET /v1/provider-catalog/providers`、`GET /v1/provider-catalog/models`与`GET /v1/provider-catalog/sync/:attemptId` routes。Read query SHALL默认`limit=30`、最大100，`q`最多100 code points，并严格校验filter与额外字段；provider SHALL按normalized name/id排序，model SHALL按status rank、`releaseDate`新到旧、normalized name/id排序（无`releaseDate`的model在同rank内排在所有有日期者之后，依name/id续序）。Status SHALL只返回safe source、counts、checked/success/stale/attempt/error与本实例projection诊断。已知attempt SHALL返回有界公开projection，且只包含`attemptId`、`trigger`、`status`、有界lifecycle timestamps与可选safe `errorCode`；response SHALL NOT包含principal、authentication、owner、response body、stack或内部audit字段。未知attempt ID SHALL返回404 `CATALOG_SYNC_ATTEMPT_NOT_FOUND`，不得以空对象、其他attempt或权限错误掩盖not-found语义。

#### Scenario: Authenticated global read
- **WHEN**authenticated workspace principal读取Catalog
- **THEN**API返回global active snapshot的whitelist page，不因global数据而允许匿名访问

#### Scenario: Model filter与默认隐藏状态
- **WHEN**client按provider、query、status或capability请求models
- **THEN**API严格应用filter；UI可默认排除deprecated/legacy并通过显式filter包含它们

#### Scenario: 模型按发布日期新到旧排列
- **WHEN**client按provider请求models且该provider存在多个不同`releaseDate`的active model
- **THEN**同一status rank内`releaseDate`较新的model排在较旧之前，分页游标在该全序上稳定

#### Scenario: Safe status
- **WHEN**最近sync失败但LKG存在
- **THEN**status返回safe error code与stale/check metadata，不回显response body、stack、secret或不必要attempt identity

#### Scenario: Authenticated attempt status read
- **WHEN**authenticated workspace principal读取一个已知sync attempt
- **THEN**API返回bounded safe attempt projection，且不泄露`principal_id`、`authentication_id`、`owner_id`、response body、stack或内部audit字段

#### Scenario: Unknown attempt ID
- **WHEN**authenticated workspace principal读取不存在或格式合法但未知的attempt ID
- **THEN**API返回404 `CATALOG_SYNC_ATTEMPT_NOT_FOUND`，且response不包含任何其他attempt或内部identity/audit信息

### Requirement: 工作区 provider 添加弹窗的 Catalog 辅助选择
Web SHALL 在工作区 provider 添加弹窗中通过既有 authenticated Catalog read API（`GET /v1/provider-catalog/providers` 与 `GET /v1/provider-catalog/models`）分页拉取 provider 与 model 列表供用户搜索选择；model 列表 SHALL 支持按选定 provider 过滤。Catalog 请求 SHALL 经同源 `/v1` 发起，不携带任何凭据、条目数据或用户输入之外的负载。用户选定 provider 与 model 后，弹窗 SHALL 以 Catalog 条目预填表单：`baseUrl` 取该 model 的 `effectiveBaseUrl`（缺失时留空待手工填写）、`modelId`、provider/model 展示名；adapter 取值 SHALL 以可改写的缺省值预填（Catalog 无协议字段时不强迫用户猜测）。预填值 SHALL 全部保持可手工改写，提交仍走 provider connection API 的既有服务端校验。用户显式改写过的 adapter 与 baseUrl 取值 SHALL NOT 被后续 provider/model 选择的重选启发重置；改写 adapter/baseUrl 也不清空、不改动已选 provider/model 及其展示信息。弹窗 SHALL 在目录区提供手动刷新入口：触发既有 manual sync 后从最新快照重载列表第一页。

#### Scenario: 选定 provider 与 model 后预填
- **WHEN** 用户在添加弹窗中从 Catalog 列表选定某 provider 与该 provider 下某 model
- **THEN** 表单的 baseUrl、modelId 与 provider/model 展示名被自动填充（baseUrl 取 effectiveBaseUrl），adapter 为可改写的缺省值，且各字段仍可手工改写

#### Scenario: adapter/baseUrl 手改不被选择重置
- **WHEN** 用户先选定 provider 与 model（adapter 被设为缺省值、baseUrl 被预填），随后手工改写「适配器类型」或「基础 URL」，再重新选择其他 provider/model
- **THEN** adapter 与 baseUrl 保持用户改写后的取值，不被缺省启发或目录预填覆盖；且改写 adapter/baseUrl 时已选 provider/model 及其展示信息不被清空或改动（未手改 baseUrl 前，改选其他 model 仍按目录预填）

#### Scenario: 模型列表最新在前
- **WHEN** 用户选定 provider 后弹窗拉取该 provider 的 model 列表
- **THEN** 同一 status rank 内模型按发布日期新到旧呈现（排序来自 read API），最新模型位于列表最前

#### Scenario: 手动刷新目录
- **WHEN** 用户在弹窗目录区点击「刷新目录」
- **THEN** 弹窗触发 manual sync（`POST /v1/provider-catalog/sync`），并在完成后从最新快照重载列表第一页；同步进行中按钮呈现进行中状态

#### Scenario: 手动刷新限流或失败
- **WHEN** manual sync 返回 429（60s 限流）、403（缺少 `provider-catalog-admin`）或请求失败
- **THEN** 弹窗以稳定文案提示原因，不自动重试、不阻塞手工录入与既有添加路径

#### Scenario: 快照变化后的旧 cursor 重载
- **WHEN** 弹窗分页请求因 Catalog active snapshot 变化返回 409 `CATALOG_CURSOR_SNAPSHOT_CHANGED`
- **THEN** 弹窗从新快照第一页重新加载列表，不把两代快照的选项混合呈现

#### Scenario: Catalog 不可用时降级手工录入
- **WHEN** Catalog 无 active snapshot 或 read API 返回不可用（如 503）
- **THEN** 弹窗展示作用域明确的 catalog 不可用状态，并降级为完整手工录入表单；添加路径不被阻塞，也不产生无界重试

#### Scenario: Catalog 请求不外发敏感数据
- **WHEN** 弹窗加载 provider/model 列表或用户输入搜索词
- **THEN** 出站请求只包含列表/过滤/分页参数，不含 API key、条目凭据或任何 chat/task 内容
