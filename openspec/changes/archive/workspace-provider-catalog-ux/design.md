## Context

- 服务端 models.dev Catalog 已就绪：`provider-catalog` 包提供快照/LKG/同步与 `GET /v1/provider-catalog/providers|models`（分页 + 快照绑定 cursor），自 browser profile 体系拆除后无消费方。
- Web 现状：`providers.tsx` 含 localStorage 探测的外置 profile 弃用横幅；`workspace-providers.tsx` 以内联表单创建/编辑条目（手填 adapter/baseUrl/model）；`chat.tsx` 运行时选择仅靠 browser-local storage，无默认值；`run-agent/settings` 下拉只显示条目名。
- 数据层已满足「同 provider 多条目」：`POST /v1/provider-connections` 每次 `conn-<uuid>`，无同名/同 provider 去重（trusted-provider-registry 既有要求）。
- Catalog projection 字段：provider `{ providerId, name, api?, npm? }`、model `{ modelId, providerId, name, status, capabilities, providerApi?, modelApi?, effectiveBaseUrl? }`——**没有 adapter 协议字段**。

## Goals / Non-Goals

**Goals:**
- 全部改动收敛在 agent-web（组件、locale、样式、测试），服务端零改动。
- 弹窗选择流复用既有 Catalog read API，保持快照/分页/降级语义。

**Non-Goals:**
- 不新增/修改任何后端 API、schema、migration、compose/smoke。
- 不做连接探测（`check-connection`）入口——后续可独立迭代。
- 不为「默认模型」新增存储字段或独立于 `providerConnectionId` 的第二套设置。
- 不清理用户浏览器中残留的 `sage.provider-profiles.*` localStorage 数据（只是不再读取）。

## Decisions

### D1: 弹窗组件形态——原生 `<dialog>` 风格的受控 modal，不复用已退役 profile UI
新建 `WorkspaceProviderDialog`（由 `workspace-providers.tsx` 承载）：`draft === undefined` 时列表页仅渲染「+ 添加」按钮；创建与编辑共用同一弹窗组件，字段与现表单一致（名称、adapter、baseUrl、model、apiKey）。样式沿用既有 `panel`/`field`/`form-actions` 体系加一层 overlay（`.modal-overlay`/`.modal-card`），Escape 与取消按钮关闭，关闭即丢弃未保存草稿（与现状一致）。备选：路由级页面（`?dialog=add` query）——放弃，改动面大且无分享弹窗 URL 的需求。

### D2: Catalog 选择器——两步选择（provider → model），懒加载 + 前端搜索缓冲
打开弹窗时拉取 provider 首页（`limit=100`，一次覆盖 models.dev 全量 provider 数），选中 provider 后按 `provider=<id>` 拉取 model 首页（`limit=100`），`q` 参数做服务端搜索、本地输入 300ms 防抖。翻页沿 `nextCursor`；收到 409 `CATALOG_CURSOR_SNAPSHOT_CHANGED` 时清空已加载页并从新快照第一页重载（不混合两代）。请求经同源 `/v1`（Vite proxy 既有），`credentials: 'include'`。
- **预填映射**：`baseUrl ← effectiveBaseUrl`（缺失留空）、`modelId ← modelId`、`providerName ← provider.name`、`modelName ← model.name`、显示名缺省建议 `"{provider.name} · {model.name}"`（可改，作为同名条目的人肉消歧手段）。
- **adapter 缺省启发**（纯 UI 缺省，可改写）：catalog `providerId === 'anthropic'` → `anthropic`，否则 `openai-compatible`。这是唯一的 id 字面特判，不进入任何路由/校验逻辑；备选「永远缺省 anthropic」会让大多数 openai-compatible 用户多改一次，放弃。
- **降级**：Catalog 请求失败/503/空快照时，弹窗顶部展示作用域化的 catalog 不可用提示（`catalogUnavailable` 键），provider/model 选择区收起，表单退化为现有手工字段——与今天能力对齐，不阻塞添加。

### D3: 默认模型 = 既有 `providerConnectionId` 引用，仅改呈现与 Chat 初始化
- 设置面：下拉选项文案改为 `{条目名} · {modelName ?? modelId}`，label 由「默认 provider」改「默认模型」；GET/PUT 契约不动。
- Chat：`runtimeId` 初始化逻辑扩展为 `localStorage 既有选择 → 工作区默认模型条目（经 `/v1/run-agent/settings`）→ ''`。默认值只在「无既有选择」时生效，且选择器可见显示为选中（满足「非静默」）；既有选择失效仍按现状清空并阻止发送，不回退默认值之外再兜底。
- 备选：新增独立的 workspace default model 字段（model 字符串）——放弃：条目已是 provider+model+凭据的原子单位，独立模型字段会与条目 modelId 漂移（条目改模型后默认值悬空），且需后端改动。

### D4: 弃用横幅直接删除，不做迁移
删除 `providers.tsx` 中 `LEGACY_PROFILE_KEYS` 探测、dismiss 状态与渲染分支，及 locale 的 `legacyProfilesTitle`/`legacyProfilesNotice`/`dismissNoticeText` 键。残留 localStorage 数据不迁移不清理（Non-Goal）。

## Risks / Trade-offs

- [Catalog 首次无快照（新部署/同步失败）→ 弹窗自动降级手工录入并有明确提示；smoke/测试覆盖降级路径] → 缓解已内置。
- [provider 列表一页 100 条若未来超限 → 使用 `nextCursor` 继续翻页加载，UI 提供「加载更多」]。
- [同 provider 多条目仅靠显示名消歧，用户可能建出同名条目 → 名称缺省建议含 provider·model；列表本身已展示 provider/model 元数据，同名不破坏任何语义（唯一性由 id 承担）]。
- [Chat 默认模型引入对 `/v1/run-agent/settings` 的额外 GET → 该端点已是轻量读；chat 加载失败时静默保持现状（''），不阻塞会话恢复]。
- [models.dev 快照变化导致弹窗内选项换页 → 409 处理统一从新快照重载，已预填字段不回改（用户已持有旧值可自行改写）]。

## Migration Plan

纯前端变更，随 web 构建发布即可，无部署顺序与回滚复杂度；回滚即回退构建。无数据迁移（浏览器残留 profile 键不读取、服务端无 schema 变化）。
