## ADDED Requirements

### Requirement: 工作区 provider 添加弹窗的 Catalog 辅助选择
Web SHALL 在工作区 provider 添加弹窗中通过既有 authenticated Catalog read API（`GET /v1/provider-catalog/providers` 与 `GET /v1/provider-catalog/models`）分页拉取 provider 与 model 列表供用户搜索选择；model 列表 SHALL 支持按选定 provider 过滤。Catalog 请求 SHALL 经同源 `/v1` 发起，不携带任何凭据、条目数据或用户输入之外的负载。用户选定 provider 与 model 后，弹窗 SHALL 以 Catalog 条目预填表单：`baseUrl` 取该 model 的 `effectiveBaseUrl`（缺失时留空待手工填写）、`modelId`、provider/model 展示名；adapter 取值 SHALL 以可改写的缺省值预填（Catalog 无协议字段时不强迫用户猜测）。预填值 SHALL 全部保持可手工改写，提交仍走 provider connection API 的既有服务端校验。

#### Scenario: 选定 provider 与 model 后预填
- **WHEN** 用户在添加弹窗中从 Catalog 列表选定某 provider 与该 provider 下某 model
- **THEN** 表单的 baseUrl、modelId 与 provider/model 展示名被自动填充（baseUrl 取 effectiveBaseUrl），adapter 为可改写的缺省值，且各字段仍可手工改写

#### Scenario: 快照变化后的旧 cursor 重载
- **WHEN** 弹窗分页请求因 Catalog active snapshot 变化返回 409 `CATALOG_CURSOR_SNAPSHOT_CHANGED`
- **THEN** 弹窗从新快照第一页重新加载列表，不把两代快照的选项混合呈现

#### Scenario: Catalog 不可用时降级手工录入
- **WHEN** Catalog 无 active snapshot 或 read API 返回不可用（如 503）
- **THEN** 弹窗展示作用域明确的 catalog 不可用状态，并降级为完整手工录入表单；添加路径不被阻塞，也不产生无界重试

#### Scenario: Catalog 请求不外发敏感数据
- **WHEN** 弹窗加载 provider/model 列表或用户输入搜索词
- **THEN** 出站请求只包含列表/过滤/分页参数，不含 API key、条目凭据或任何 chat/task 内容
