## Why

unify-provider-model 之后，「服务商」页的添加入口退化为一段平铺的内联表单：用户需要手工填写 adapter/base URL/model id，没有任何目录辅助；页面上仍残留已退役外部配置（browser-local profile）的一次性弃用横幅；「运行 Agent」默认 provider 下拉在同名/同 provider 多条目场景下无法按模型区分；Chat 运行时选择完全依赖 browser-local 记忆，工作区没有可设定的默认模型。与此同时，服务端 models.dev Catalog（`/v1/provider-catalog/*`，快照/LKG/同步已就绪）自 browser profile 体系拆除后没有任何消费方，成为孤立能力。

## What Changes

- **移除外置 profile 弃用提示**：删除 Providers 页基于 localStorage 探测的一次性弃用横幅及其 `legacyProfiles*` 文案键；不再读取 `sage.provider-profiles.*` 任何键。
- **添加/编辑 provider 改为弹窗**：创建与编辑工作区 provider 条目一律在 modal dialog 中完成，条目列表页不再展开内联表单。
- **models.dev 目录辅助选择**：弹窗内从既有服务端 Catalog API（`GET /v1/provider-catalog/providers`、`GET /v1/provider-catalog/models`）分页拉取 provider 与 model 列表供搜索选择；选定后自动预填 `baseUrl`（effectiveBaseUrl）、`modelId`、`providerName`、`modelName` 与 adapter 缺省值，字段仍可手工改写；Catalog 不可用（无快照/503）时弹窗降级为完整手工录入，不阻塞添加。
- **同 provider 多条目**：弹窗与列表显式支持同一 provider 重复添加（不同 key/不同模型/不同命名），唯一性仍由条目 `id` 承担（registry 既有语义），列表以「条目名 · provider · model」区分。
- **工作区默认模型**：`运行 Agent` 设置呈现为「默认模型」选择（选项展示 provider · model · 条目名），存储仍为 `providerConnectionId` 引用（无新字段、无 API 破坏）；Chat 运行时选择器在无 browser-local 选择时以工作区默认模型为初始选中（可见呈现，非静默回退），显式选择失效时仍阻止发送。
- 不改变：provider connection API 契约、凭据只写不读语义、包运行准入/执行检查、Catalog 同步与快照治理、chat 提交的 `{ connectionId }` 引用形态。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `provider-model-catalog`: 新增浏览器侧消费契约——工作区 provider 添加弹窗使用 Catalog read API 做 provider/model 辅助选择（分页、快照绑定、选择不触发 probe），Catalog 不可用时降级手工录入。
- `trusted-provider-registry`: 新增条目管理界面契约——添加/编辑以弹窗承载、目录预填不改变服务端校验边界、同 provider 重复添加在 UI 层不受限制且可区分。
- `run-agent-settings`: 设置面从「默认 provider」升格为「默认模型」呈现（provider·model·条目名），并定义其作为 Chat 初始运行时的语义；存储与 API 契约不变。
- `chat-user-interface`: 「Chat 运行时快速选择器」增加工作区默认模型初始选中规则（仅无 browser-local 选择时生效，失效显式选择仍阻止发送）。
- `web-interface-localization`: 移除存量外部配置弃用提示键，新增弹窗、目录辅助与默认模型相关 message key（zh-CN/en 键集一致）。

## Impact

- **Web（主要改动面）**：`platform/apps/agent-web/src/providers.tsx`（删除弃用横幅与 legacy localStorage 探测）、`workspace-providers.tsx`（内联表单改为 modal、接入 Catalog 选择器）、`chat.tsx`（运行时选择器初始值规则）、`locale.tsx`（键增删）、样式与相应测试（`providers.test.tsx` 等）。
- **服务端**：无 API/存储变更。`provider-catalog` 包与 `/v1/provider-catalog/*` 路由按现状复用（首次消费方为 web）。
- **契约**：`RunAgentSettings` 请求/响应 schema 不变；`provider-connections` API 不变；chat 提交形态不变。
- **测试/验证**：web 单测（弹窗流程、降级路径、默认模型选择与 chat 初始化）、既有 providers/chat 测试更新；无数据库 migration、无 compose/smoke 变更。
