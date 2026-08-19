## Context

当前 `ProvidersApp` 已有 `idle|creating|editing|saving` 状态机、Provider/Model Catalog combobox、`ProviderProfileV2` localStorage metadata 和当前 tab `sessionStorage` secret。新增体验需要同时修改 Web 交互、app-contracts/API 路由和测试；Provider profile 仍然只是配置 UI，不得改变 Local PiHarness。

## Goals / Non-Goals

**Goals:**

- 用 accessible dialog 承载新增流程，并按 Provider → Model → 可编辑字段 → API key → 保存的顺序组织表单。
- Provider 选择后默认将 `name` 填成 Provider 名称；Catalog model/provider 的合法 HTTPS URL 自动填入，但用户可以覆盖。
- 保存后新增 profile 可见，并在 profile 列表提供单次连接检测按钮和明确的 idle/checking/success/failure 状态。
- 连接检测请求严格白名单、超时、有界、拒绝 redirect，不持久化或回显 API key。

**Non-Goals:**

- 不实现 provider-backed Chat/Task execution、OAuth、server-side profile storage 或 secret sync。
- 不改变 Catalog sync/source、`ProviderProfileV2` metadata schema、Chat/Task payload、Local Pi runtime。
- 不保证所有 Provider 的统一业务 completion 验证；检测只验证配置的 model-list endpoint 能否以当前凭据响应。

## Decisions

### 1. 新增流程使用 dialog，不复制 editor 状态机

保留 `EditorState` 作为唯一 draft 状态。`creating` 渲染 `role="dialog" aria-modal="true"` 的 modal，`editing` 继续使用现有页面 editor。新增 modal 的首个表单控件是 Provider combobox；选择 Provider 时写入 providerId/providerName、清理旧 model/base URL，并在 name 未 dirty 时写入 provider.name。选择 model 只更新 model metadata 和 source URL，不覆盖已经自动填充或用户修改的 name。创建成功后关闭 modal，编辑保存继续留在 editor。

备选方案是新建独立 AddProviderForm 状态，但会复制 catalog debounce、snapshot guard 和 secret 规则，增加状态分叉，因此不采用。

### 2. 连接检测走 API-side bounded probe

新增 `POST /v1/provider-catalog/check-connection`。body 使用 `ProviderConnectionCheckRequest` 白名单：`adapterKind`、`baseUrl`、`modelId`、`apiKey`；API 只接受 HTTPS URL、限制长度、拒绝 localhost/环回/私网主机名，规范化 URL 后请求 `${baseUrl}/models`，不跟随 redirect，8 秒 timeout，响应体不读取。OpenAI-compatible 使用 `Authorization: Bearer <key>`，Anthropic 使用 `x-api-key` 与 `anthropic-version`；无 key 仍可探测但通常返回 unauthorized。API 对上游 2xx 返回 `connected`，401/403 返回 `unauthorized`，其他 HTTP/网络/超时返回 `unavailable` 和稳定非敏感 message；绝不把上游 body、URL 中的 credential、cause 或 key 放进 response/log。

使用 API-side 而非 browser direct fetch，是为了避免 CORS 使检测不可用，同时将 secret 传输限制在已认证 Sage API。使用一次性 request body 而非读取 localStorage/sessionStorage，是为了保证 API 不拥有 profile 生命周期。

### 3. Web 连接图标使用 profile id keyed state

Web 维护 `Record<profileId, ConnectionCheckState>`，状态为 `idle|checking|connected|unauthorized|unavailable`。点击图标读取当前 tab 对应 secret；没有 key 时不发请求，显示“请先输入 API key”。有 key 时仅发送检测所需字段，成功/失败提示通过 `aria-label`、`title` 和短文本呈现。检测按钮与编辑入口分离，避免点击检测打开 editor；checking 时禁用同一 profile 按钮但不影响其他 profile。

### 4. 类型与错误边界

在 `@sage/app-contracts` 增加 strict request/response schema 和 connection status union。Fastify route 使用 TypeBox `additionalProperties:false`，schema validation 失败沿用 `CATALOG_INVALID_REQUEST`；连接业务结果使用 200 bounded response，避免把用户可修复的 unauthorized 当成 API 事故。所有测试使用注入的 `probe`/`fetch` 替身，不访问真实外部 Provider。

## Risks / Trade-offs

- [Risk] 用户自定义 HTTPS endpoint 可能指向内部服务 → API 拒绝 localhost、环回、常见私网/`.local` hostname，并使用 redirect error；这是对自托管私有 Provider 灵活性的明确限制。
- [Risk] Provider API 对 `/models` 需要不同协议 → 只声明“能访问 model-list endpoint”的连接检测，不声称 completion 兼容性；失败状态保留可重试入口。
- [Risk] API key 经 API 请求传输 → 仅在显式检测动作中发送，服务端不持久化/记录/回显，前端仍只从当前 tab sessionStorage 读取。
- [Risk] modal 在小屏空间不足 → 使用可滚动 modal body 和现有 responsive styles，保留 Escape/Cancel 关闭语义。

## Migration Plan

1. 先加入 contracts、API route/probe 与定向测试。
2. 再改 Web Provider modal、默认填充、连接按钮和 UI 测试。
3. 运行 Provider targeted tests、typecheck、Web build；失败时只回滚新增 route/UI，不触碰既有 profile storage。

## Open Questions

无阻塞问题。连接检测图标使用现有 Unicode `↻`/`✓`/`!` 文本符号，避免新增图标依赖。