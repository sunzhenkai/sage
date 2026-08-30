# Tasks: agent-web-multica-style-alignment

## 1. locale 密度门禁（先行，防回潮）

- [x] 1.1 在 `locale.test.tsx` 新增密度门禁断言：遍历 `messageKeys`，非豁免 key 中文按字计（剔除 `{placeholder}`）≤24 字、英文按空白分词 ≤10 词；定义 `EXEMPT` 白名单常量，每条带注释归类（安全语义/可操作错误/字段 hint）：`effectUnknownTitle`、`effectUnknownBody`、`effectUnknownGuidance`、`scheduleAuthRequired`、`chatNeedsProvider`、`workspaceRuntimeUnavailable`、`catalogSyncRateLimited`、`catalogSyncForbidden`、`catalogUnavailableManual`、`appIdHint`、`apiKeyServer`、`apiKeyRequiredPlaceholder`、`apiKeyRotatePlaceholder`、`uploadFilesPlaceholder`、`enterToSend`
- [x] 1.2 运行门禁确认当前字典中待治理 key 全部失败（红），作为任务 3 的验收清单来源

## 2. 文案治理（locale.tsx 双语同步，按 design.md D7 清单）

- [x] 2.1 P1 页面定位句删除：`operationsCenter`、`durableExecution`（eyebrow 用途）、`schedulesEyebrow`、`tasksSubtitle`、`packagesSubtitle`、`schedulesSubtitle`、`providersSubtitleUnified`、`resumeConversation`、`startOutcome`、`chatPrompt`，及 `workspaceSettings`/`conversationHistory` 的 eyebrow 用途（key 保留处改为不再被页头引用）
- [x] 2.2 P2 机制解释句：`controlsAuthorized` 迁入控制按钮组 `title`；`taskCardTitle` 换用 `promoteTask` 短词、`taskCardBody` 迁入 `title`；`startRunHint` 压缩为「基于最新 Release 创建运行，参数留空用默认值」/「Created from the latest release; blank params use defaults」；`runAgentSubtitle`、`workspaceProvidersSubtitle` 删除（密封语义由 `apiKeyServer` hint 承载）；`importExamplesHint` 压为一行；`promoteImportant`、`artifactsPending`、`timelineProjectionLagging`、`chatRetention`、`noPackagesHint` 压缩；`staleAgeThreshold` 迁入 `title`
- [x] 2.3 P3 状态解释句：删除 `archivedReadOnlyExplanation`、`closedExplanation`、`composerReadOnlyExplanation`、`archiveEmptyHint`、`startChatExplicit`（徽章与动作保留）
- [x] 2.4 P4 后果预告句：`confirmScheduleDelete`、`deleteWorkspaceProviderConfirm`、`deleteAppConfirm` 压缩为后果一行；`deleteDefaultModelWarning`、`deleteConfirmWarning` 保留风险本体
- [x] 2.5 P5 结果播报句：`conversationArchived`/`conversationRestored`/`conversationDeleted`→「已归档/已恢复/已删除」；`eventStreamCopied`→「已复制 {count} 个事件」；`copyFailedMessage`→「复制失败」；`promotionAccepted`/`retryRequested`/`catalogSyncReloaded`/`workspaceProviderSaved`/`workspaceProviderDeleted`/`runAgentSaved` 同式压缩
- [x] 2.6 清理无人引用的死 key（删除句对应引用已移除后），确认 `locale.test.tsx` 双语齐全断言与 1.1 门禁全绿

## 3. 壳层：三栏框架与侧栏精简（main.tsx / styles.css）

- [x] 3.1 `styles.css` 新增 `.content-split` / `.list-pane`（280px、右侧发丝边框）/ `.content-pane` 布局类与 ≤700px 整页切换退化（列表栏占满、选中后隐藏）
- [x] 3.2 `main.tsx` 侧栏：删除 brandSubtitle 节点与 `.sidebar-footnote`；导航上方新增 `.sidebar-primary-action`（新建对话，复用 POST /v1/chat/sessions 逻辑）与 `.sidebar-search` 静态搜索视觉位（⌘K）
- [x] 3.3 语言切换控件从侧栏移除，迁入服务商页底部「偏好」卡；`sidebar-collapse.test.tsx` 同步更新（收起态主操作图标可见可点）
- [x] 3.4 `header-alignment.test.tsx` 更新：断言侧栏无副标题/脚注、存在主操作入口

## 4. 对话视图三栏化（workspace.tsx / chat.tsx）

- [x] 4.1 `ChatLanding` 重构为列表栏内容（顶行「对话 +」、搜索、对话/归档 tabs、会话行、加载更多），删除整页页头（conversationHistory/chatWorkspace/resumeConversation 引用移除）；`workspace-page` 加 `aria-label`
- [x] 4.2 内容区空态：居中图标 + 单句（「选择一个对话，或点 + 新建」/「Select a conversation, or start a new one」）
- [x] 4.3 `chat.tsx` 头部收窄为单行：会话标题 + 连接状态点居左；运行时选择器、事件流开关、「提升为任务」按钮（`promoteTask` + `title={t('taskCardBody')}`）居右；`session-info-bar` 中 SESSION/EVENTS/RUN 压缩为紧凑元信息
- [x] 4.4 时间线空态单句化（`timeline-empty` 去双行标题）；快速提示 chips 保留在输入区上方
- [x] 4.5 归档操作反馈改用压缩后完成式文案；行内删除确认只保留不可撤销警示一行
- [x] 4.6 `workspace.test.tsx`、`chat*.test.tsx` 适配；`responsive-a11y.test.tsx` 增 390px 对话视图无横向溢出断言

## 5. 任务视图（tasks.tsx）

- [x] 5.1 列表页头单行化：删 `operationsCenter` eyebrow 与 `tasksSubtitle`，保留「任务」H1 + 运行中计数 chip + 刷新；`tasks-page` 加 `aria-label`
- [x] 5.2 状态筛选下拉替换为 chips 组（复用 `.view-switch` 模式 + `aria-pressed`），`aria-label={t('status')}` 迁移至 chips 容器
- [x] 5.3 `TaskList` 删除 `.task-list-heading` 内 eyebrow 与大计数（保留 section aria-label）；空态 hint 用压缩后 `promoteImportant`
- [x] 5.4 `TaskDetail` 页头精简（返回链接 + ID + 徽章 + 刷新）；删 `controlsAuthorized` 段并迁入 `.control-grid` `title`；详情卡 eyebrow 删除、H3 名词保留
- [x] 5.5 效果未知 Banner 改为标题 + 可展开详情（`<details>` 或等价），首屏只留警示与锁定语义
- [x] 5.6 `tasks.p6.test.tsx`、`tasks.interaction.p6.test.tsx`、`tasks-race.test.tsx` 适配

## 6. 应用视图弹窗化（packages.tsx）

- [x] 6.1 新增 `Modal` 原语（`role="dialog"`、`aria-modal`、面包屑式标题、Esc 关闭、Tab 焦点圈定）
- [x] 6.2 列表页头单行化（删 eyebrow/`packagesSubtitle`，右侧「导入示例」「新建应用」按钮）；列表区删除重复 eyebrow 与大计数
- [x] 6.3 新建应用表单迁入 Modal；示例导入清单迁入 Modal（hint 一行）
- [x] 6.4 发起运行面板 `startRunHint` 压缩为一行；空态改单行短句 + 动作按钮
- [x] 6.5 `packages.test.tsx` 适配；`responsive-a11y.test.tsx` 增 dialog 断言（role/aria-modal/Esc）

## 7. 服务商页设置形态（providers.tsx）

- [x] 7.1 改 `settings-layout`：左子导航（运行 Agent / 工作区 Providers / 模型目录 / 偏好）+ 右内容卡，子导航以 `?view=providers&section=` 查询参数切换（客户端路由）
- [x] 7.2 删除 `runAgentSubtitle`、`providersSubtitleUnified`、`workspaceProvidersSubtitle` 引用；密封凭据语义并入 API key 字段 hint
- [x] 7.3 语言切换控件落地「偏好」卡（承接任务 3.3）
- [x] 7.4 `providers.test.tsx`、`workspace-providers.confirm.test.tsx` 适配

## 8. 定时任务页与全局收尾

- [x] 8.1 `schedules.tsx` 页头单行化（删 `schedulesEyebrow`/`schedulesSubtitle`）
- [x] 8.2 全局检查：无残留 `page-subtitle` 类引用；全部 `workspace-page` 有可访问名；`grep` 确认 P1–P5 清单 key 无悬挂引用
- [x] 8.3 agent-web 全量 vitest、typecheck、build 全绿
- [x] 8.4 浏览器截图验收留档：对话三栏（含空态与选中态）、任务 chips、应用新建/导入弹窗、服务商设置形态、390px 对话与任务视图；归档时附于 change evidence/

## 9. Spec 回写校验

- [x] 9.1 `openspec validate agent-web-multica-style-alignment --strict` 通过
- [x] 9.2 确认 delta 与主 spec 的 MODIFIED 条目在归档时可干净合并（特别是 `web-interface-design-language` 的质量底线条款与 `workspace-status-presentation` 的页头条款）

## 完成留档说明

- 测试：agent-web 161/161 通过（含新增 locale 密度门禁、Modal 语义、三栏窄屏契约）；平台全量 1029 通过、2 失败为基线既有的无关问题（harness-pi 预算用例、agent-platform-final preflight），本次改动文件零关联；typecheck/build 全绿。
- 实现偏离记录：`workspaceSettings` key 最终随引用清零删除（proposal 中曾标保留）；`conversationHistory` 保留并转为列表栏 aria-label（落实「删文字不删标签」）；`createSessionFailed` 保留并通过 NewChatButton onError 通道恢复创建失败反馈。
- 浏览器验收：evidence/01-08（对话三栏空态/会话态、任务 chips、任务详情、应用创建弹窗、服务商设置形态、390px 会话与落地页）。
