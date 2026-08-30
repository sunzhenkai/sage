# Design: agent-web-multica-style-alignment

## Context

agent-web 为单页 React 应用（`platform/apps/agent-web/src/`），壳层在 `main.tsx` 的 `WorkspaceShell`（固定侧栏 244px + `main-column` 白案面），五个视图经 `?view=` 查询路由切换；全部文案集中在 `locale.tsx` 双语字典（230+ key），样式唯一入口为 `styles.css` 的素笺设计令牌。动机见 proposal.md。既有约束：`web-interface-design-language` 的「呈现层零行为变更」条款要求类名钩子保持不变，本 change 需以显式白名单突破；`responsive-a11y.test.tsx` 对 `styles.css` 做字面断言；`header-alignment.test.tsx` 断言壳层无 topbar/breadcrumbs。

## Goals / Non-Goals

**Goals:**
- 壳层三栏化（侧栏 / 列表栏 / 内容区），对话视图首批落地，≤700px 列表栏抽屉化。
- 全部视图页头单行化；五类说明书句（页面定位句、机制解释句、状态解释句、后果预告句、结果播报句）按清单删除或压缩。
- 任务状态筛选 chips 化；应用新建/导入弹窗化；服务商页设置形态（子导航 + 内容卡）。
- locale 密度门禁测试（zh ≤24 字 / en ≤10 词 + 豁免白名单）先行落地，防回潮。
- 删除元素的可访问名迁入 `aria-label`，`data-testid` 与路由语义零变化。

**Non-Goals:**
- 任务看板化（按状态分列的卡片看板）、全局搜索 ⌘K 真实实现、键盘快捷键体系（新建 C、弹窗 ⌘↵）——列入后续 change。
- 任务/应用列表迁入第二栏（本期仅对话视图三栏化）。
- 素笺配色主题更换（不动 `--paper`/`--pine`/`--sealred` 等令牌，只调密度与形态）。
- 任何 HTTP API、运行时、数据模型变更。

## Decisions

### D1 三栏实现：`content-split` 组合而非路由重构

在 `main-column` 内新增 `content-split` 容器（`display: flex`；左列 280px 固定宽、带右侧发丝边框；右列 `flex: 1`），对话视图渲染 `<ListPane>{会话列表}</ListPane><ContentPane>{会话或空态}</ContentPane>`。其余视图本期不启用分栏，保持整页内容。

备选：为每个视图都建第二栏 → 拒绝，范围爆炸且任务/应用列表信息量不足以常驻一栏。
备选：用 CSS grid 模板区域在壳层统一切分 → 拒绝，对话列表的数据加载、搜索、归档切换状态都在 `ChatLanding` 内，抽离到壳层会撕裂状态归属；`content-split` 由视图自行组装，壳层只提供布局类。

### D2 侧栏精简：删文字、加主操作，不动结构

- 删除 `.brand-copy small`（`brandSubtitle`）与 `.sidebar-footnote`（`runtimeFootnote`）：信息分别与品牌名、运行时卡片重复。
- 导航上方新增 `.sidebar-primary-action`「新建对话」按钮（复用 `newChat` 文案与 `POST /v1/chat/sessions` 后跳转的既有逻辑，从 `ChatLanding` 提升为壳层职责）与 `.sidebar-search` 搜索视觉位（静态 `⌘K` 提示，本期不绑定功能）。
- 语言切换控件从侧栏底部移除，迁入服务商页底部「偏好」卡。备选：收进用户账户菜单 → 拒绝，账户菜单当前无弹层基础设施，新建成本高于平移。

### D3 页头单行化与 aria 迁移

各视图 `page-heading` 压为一行：`<h1>` + `.page-heading-actions`。删除的 eyebrow 文案若承担 section 可访问名，迁移为 `aria-label`（如 `packages-page` 的 `aria-label={t('packages')}`）。`page-subtitle` 类与对应 locale key 一并删除——这构成对「类名钩子不变」条款的白名单突破，登记见 D7。

### D4 任务筛选 chips 复用现有 view-switch 模式

`workspace.tsx` 的归档/对话切换已是 chips 形态（`.view-switch` + `aria-pressed`）。任务状态筛选复用该模式：`statusFilter` 状态与过滤逻辑不变，下拉 `<select>` 替换为 chips 组（全部/运行中/已暂停/失败/已成功/已取消）。下拉控件从 DOM 删除，其 `aria-label={t('status')}` 迁移到 chips 组容器。

### D5 应用弹窗化：新建 `<Modal>` 原语而非引入依赖

项目零 UI 依赖。新建轻量 `Modal` 组件（`fields.tsx` 同级）：`role="dialog"` + `aria-modal` + 面包屑式标题 + Esc 关闭 + 焦点圈定（focus trap 最小实现：Tab 循环在弹窗内）。新建应用表单与示例导入清单从内联卡片迁入两个 Modal 实例。备选：保留内联卡片只压缩文案 → 拒绝，内联卡片仍占用列表首屏且与 multica 创建形态不符。

### D6 服务商页设置形态：左子导航 + 右内容卡

`providers.tsx` 改为 `.settings-layout`（左 200px 子导航：运行 Agent / 工作区 Providers / 模型目录；右侧内容卡）。子导航为锚点滚动的 section 切换（`?view=providers&section=` 查询参数保持可分享，沿用客户端路由）。三段说教长句（`runAgentSubtitle`、`providersSubtitleUnified`、`workspaceProvidersSubtitle`）删除，密封凭据语义压为 API key 字段 hint（`apiKeyServer` 保留）。

### D7 文案治理：P1–P5 清单 + 门禁测试先行

`locale.tsx` 按五类模式处置约 70 条（明细清单附于 tasks.md 任务 3）：
- **P1 页面定位句**（删）：`operationsCenter`、`durableExecution`、`schedulesEyebrow`、`workspaceSettings`（作 eyebrow 用时）、`conversationHistory`（作 eyebrow 用时）、`tasksSubtitle`、`packagesSubtitle`、`schedulesSubtitle`、`providersSubtitleUnified`、`resumeConversation`、`startOutcome`、`chatPrompt`。
- **P2 机制解释句**（删或压缩为 ≤1 行）：`controlsAuthorized`→迁入按钮 `title`；`taskCardTitle`→「提升为任务」复用 `promoteTask`，`taskCardBody`→`title`；`startRunHint`→「基于最新 Release 创建运行，参数留空用默认值」；`runAgentSubtitle`/`workspaceProvidersSubtitle`→删，语义并入字段 hint；`importExamplesHint`→一行；`promoteImportant`、`artifactsPending`、`timelineProjectionLagging`、`chatRetention`、`noPackagesHint`→压缩；`staleAgeThreshold`→`title`。
- **P3 状态解释句**（删解释段，保留徽章与动作）：`archivedReadOnlyExplanation`、`closedExplanation`、`composerReadOnlyExplanation`、`archiveEmptyHint`、`startChatExplicit`。
- **P4 后果预告句**（只留后果一行）：`confirmScheduleDelete`→「删除该定时任务？」；`deleteWorkspaceProviderConfirm`→「删除后不可恢复」级；`deleteAppConfirm` 删「保留用于审计」；`deleteDefaultModelWarning` 保留（含可操作后果）。
- **P5 结果播报句**（完成式短句）：`conversationArchived`/`conversationRestored`/`conversationDeleted`→「已归档/已恢复/已删除」；`eventStreamCopied`→「已复制 {count} 个事件」；`copyFailedMessage`→「复制失败」；`promotionAccepted`/`retryRequested`→「已接受/已请求重试」；`catalogSyncReloaded`、`workspaceProviderSaved/Deleted`、`runAgentSaved` 同式压缩。

**豁免白名单**（登记在 `locale.test.tsx`）：`effectUnknownTitle/Body/Guidance`（安全语义）、`scheduleAuthRequired`/`chatNeedsProvider`/`workspaceRuntimeUnavailable`/`catalogSyncRateLimited`/`catalogSyncForbidden`/`catalogUnavailableManual`（可操作错误）、`appIdHint`/`apiKeyServer`/`apiKeyRequiredPlaceholder`/`apiKeyRotatePlaceholder`/`uploadFilesPlaceholder`（字段 hint/placeholder）、`enterToSend`（键位说明）。

门禁实现：`locale.test.tsx` 新增断言——遍历 `messageKeys`，非豁免 key 的 zh 值 `Array.from(str).length ≤ 24`（按字计，不含 `{placeholder}` 占位符）、en 值按空白分词 ≤10 词；豁免 key 必须在 `EXEMPT` 集合中且集合内每个 key 带注释归类（安全语义/可操作错误/字段 hint）。长度上限对现有合规 key 留出余量（当前合规 key 最长约 18 字）。

### D8 类名突破白名单（对「呈现层零行为变更」条款）

本 change 删除以下可见元素及类名引用，理由均为「装饰/说明书元素，无交互承载」：

| 类名/选择器 | 位置 | 删除理由与 aria 迁移 |
|---|---|---|
| `.brand-copy small`（brandSubtitle 节点） | main.tsx 侧栏 | 与品牌名重复；品牌块 aria-label 保留 |
| `.sidebar-footnote` | main.tsx 侧栏 | 与运行时卡片重复；无语义损失 |
| `.page-subtitle`（全部视图） | 五个视图页头 | 说明书句；各 `workspace-page` 加 `aria-label` |
| 页头 `.eyebrow`（视图级） | 五个视图页头 | 讲解词；同上 |
| `.task-list-heading` 内 eyebrow 与大计数 | tasks.tsx / packages.tsx | 与页头重复；列表 section aria-label 保留 |
| 详情卡 `.eyebrow` | tasks.tsx 详情卡 | 讲解词；卡标题 H3 保留 |
| 控制卡说明段 `.muted-copy`（controlsAuthorized） | tasks.tsx | 迁入 `.control-grid` 的 `title` |
| chat `session-info-bar` 中 `taskCardTitle` 长标签 | chat.tsx | 换用 `promoteTask` 短词 + `title` |

除此之外不改任何 `data-testid`、aria 属性、路由参数与请求时序。

### D9 窄视口退化

≤700px 时 `content-split` 切换为整页切换模式：列表栏占满内容区，选中会话后列表栏 `display: none`（保留返回按钮回到列表）。390×844 任务行三要素与顶部横向导航形态条款不变，`responsive-a11y.test.tsx` 增一条对话视图 390px 无横向溢出断言。

## Risks / Trade-offs

- [文案压缩丢失引导信息，新用户不理解“提升为任务”] → 说明迁入 `title`/tooltip 保留触达路径；空态保留单行引导；豁免清单保住安全语义。
- [删除 `.page-subtitle` 等类名破坏对 styles.css 做字面断言的测试] → 与测试改写同 PR 完成；design 白名单（D8）逐条登记，review 可对照。
- [三栏化在 390px 下挤压会话内容] → D9 整页切换退化 + 新断言兜底。
- [Modal 焦点圈定手写实现有 a11y 遗漏] → 最小实现 + `responsive-a11y.test.tsx` 增加 dialog 断言（role/aria-modal/Esc）。
- [密度门禁上限误伤未来合理长文案] → 上限取现有合规值 +6 字余量；豁免需改测试清单，流程上强制评审而非阻断。
- [语言切换迁入服务商页降低发现性] → 接受：低频设置项，符合设置页形态；侧栏折叠测试同步更新。

## Migration Plan

纯前端呈现层变更，无数据迁移。发布顺序：locale 门禁测试（含白名单）→ 文案删改 → 结构改动（三栏/页头/chips/弹窗/设置形态）→ 断言测试适配 → 浏览器截图验收（对话三栏、任务 chips、应用弹窗、服务商设置形态、390px 退化）。回滚：单 change revert 即可，无状态残留；侧栏折叠与 locale 的 localStorage key 不变。

## Open Questions

（无。任务看板化与全局搜索已显式划入 Non-Goals 留待后续 change。）
