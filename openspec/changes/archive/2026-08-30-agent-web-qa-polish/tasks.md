# Tasks: agent-web-qa-polish

## 1. 会话列表栏修复（workspace.tsx / styles.css）

- [x] 1.1 行操作按钮对齐：归档/恢复/删除按钮与行内容垂直居中（`align-self: center` 或绝对定位），消除悬空错位
- [x] 1.2 当前会话选中高亮：`ChatSessionList` 从 `location.search` 读 `session`，命中行加 `is-active` 与 `aria-current="page"`，新增高亮背景规则
- [x] 1.3 英文徽章/日期重叠修复：日期列改紧凑格式（见 7.1）且固定宽度，徽章与日期互不重叠
- [x] 1.4 搜索框宽度修正：`.list-pane .search-field` 不超宽、不贴右缘
- [x] 1.5 `workspace.test.tsx` 增加选中高亮与 aria-current 断言

## 2. 会话页头部修复（chat.tsx / styles.css）

- [x] 2.1 头部标题改为当前会话标题（取 session detail 的 title，缺省回退 `t('chat')`）
- [x] 2.2 动作区分组为 `.chat-heading-info` 与 `.chat-heading-tools`，各加 `min-width: 0`，消除单一控件孤行
- [x] 2.3 事件流面板删除头部重复的会话信息条（session/events/run），只留复制按钮与事件列表
- [x] 2.4 `header-alignment.test.tsx` 更新头部结构断言；`chat.conversation.test.tsx` 适配事件流面板去重

## 3. 任务详情修复（tasks.tsx / styles.css）

- [x] 3.1 详情态隐藏列表页头刷新按钮，消除双刷新
- [x] 3.2 attempt 选择器 `max-width` 放宽至 `min(320px, 100%)`，标签完整可读
- [x] 3.3 `noProjectionEvents` 改为「暂无时间线事件 / No timeline events yet」，去除「投影」术语
- [x] 3.4 `tasks.p6.test.tsx` / `tasks.interaction.p6.test.tsx` 适配刷新唯一性与空态文案

## 4. 应用详情修复（packages.tsx）

- [x] 4.1 manifest 卡隐藏空值字段（skills/capabilities/inputs/dataSources 为空不渲染行）
- [x] 4.2 发起运行卡无参数时不渲染悬空 form-actions 分隔线
- [x] 4.3 列表行版本号去双写（保留徽章，删副标题中的「最新版本 · vX」）
- [x] 4.4 `packages.test.tsx` 适配

## 5. 服务商页修复（workspace-providers.tsx / providers.tsx / fields.tsx）

- [x] 5.1 provider 编辑弹窗迁移到 `Modal` 原语（面包屑「服务商 › …」），操作区「取消在左、保存在右」
- [x] 5.2 字段栅格收敛：适配器/基础 URL 与模型对齐为一致两行布局
- [x] 5.3 `settings-nav` 增加 `aria-current` 与 active 背景
- [x] 5.4 `workspace-providers.confirm.test.tsx` 适配弹窗结构与按钮顺序

## 6. 定时任务页修复（schedules.tsx）

- [x] 6.1 错误态由裸 `banner banner-error` 替换为全局 `Banner` 组件（保留 service token 配置指引文案）
- [x] 6.2 `schedules.test.tsx` 增加错误态样式断言

## 7. 壳层与时间格式（main.tsx / styles.css / locale.tsx）

- [x] 7.1 新增 `formatCompact`（MM-DD HH:mm 双语同构），`ChatSessionList` 与任务/应用列表时间统一采用；长格式保留于详情页 hover `title`
- [x] 7.2 折叠态 `.sidebar-head` 垂直堆叠（印章在上、切换按钮在下），消除挤压
- [x] 7.3 搜索视觉位文案中性化为「搜索」+ `⌘K`
- [x] 7.4 壳层 `NewChatButton` 创建失败经行内提示/notice 通道展示错误，恢复可用态
- [x] 7.5 `sidebar-collapse.test.tsx` 增加折叠态头部堆叠与主操作错误出口断言

## 8. 收尾

- [x] 8.1 全局检查：无裸文本错误态、无重叠/截断；`grep` 确认无残留问题类名
- [x] 8.2 agent-web 全量 vitest、typecheck、build 全绿；平台全量测试无新增失败
- [x] 8.3 浏览器截图验收（修复后对照 QA 原图）：列表行对齐/选中高亮、英文重叠修复、头部孤行消除、任务详情单刷新、provider 弹窗按钮顺序、定时任务错误态、折叠态堆叠、紧凑时间格式；归档至 change `qa-fixed/`
- [x] 8.4 `openspec validate agent-web-qa-polish --strict` 通过，delta 可干净合并
