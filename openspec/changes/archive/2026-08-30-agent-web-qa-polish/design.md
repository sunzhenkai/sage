# Design: agent-web-qa-polish

## Context

`agent-web-multica-style-alignment` 已完成三栏壳层、话语层治理与 locale 密度门禁，并在 QA 中记录 24 个问题（7 P1 / 11 P2 / 6 P3），截图见该 change `qa/`。本设计只覆盖 P1 与 P2 中可独立交付、低风险且可测试的修复；P3 打磨项与需产品判断的项显式列入 Non-Goals。

## Goals / Non-Goals

**Goals:**
- 消除 7 个 P1：A1 归档按钮错位、A2 会话选中高亮、A4 英文徽章/日期重叠、A5 搜索框截断、B1 头部孤行、C1 双刷新、E1 provider 弹窗按钮顺序、F1 定时任务错误态裸文本。
- 消除 11 个 P2：A6 日期紧凑格式、B2 会话标题、B4 事件流面板去重、C2 attempt 截断、C3 时间线空态去术语、D1 悬空分隔线、D2 弹窗形态统一、E2 字段栅格收敛、E3 子导航 active 态、G1 折叠态头部堆叠、G2 搜索视觉位中性化、G3 壳层主操作错误出口。
- 每项修复伴随测试断言更新或新增；`data-testid`/aria 不变。

**Non-Goals:**
- A3 预览去 markdown（需新增轻量行内剥离器，可后续做）。
- B3 「提升为任务」同名歧义（需产品决策改文案还是合并行为）。
- C4 时间线与运行日志并存矛盾的叙事统一（需信息架构层决策）。
- C5/C6、D3/D4 中属信息密度的打磨（已部分由 D1 覆盖，其余后续）。
- D5 上传改文件选择器、B5 运行时下拉文案、B6 dev-only HMR 报错、F2 401 console 噪声。
- 移动端深度适配（用户明确从简）。

## Decisions

### D1 会话列表行：两行布局收敛 + 紧凑时间

`history-row` 在 `.list-pane` 内已改两行。修复 A1/A4/A6：
- 行操作（归档）改为与 meta 行同高的绝对定位或 `align-self: center`，消除悬空。
- 时间用 `formatCompact`（`MM-DD HH:mm`，双语同构），替代 `formatDateTime` 长格式；日期列固定宽度防抖动。
- 选中态：`ChatSessionList` 读 `location.search` 的 `session`，命中行加 `is-active` 类与 `aria-current="page"`；新增 `.history-entry.is-active .history-row` 高亮背景。

### D2 会话页头部：动作区分组 + 会话标题

修复 B1/B2/B4：
- 头部左区标题改为 `sessionTitle ?? t('chat')`（`ChatApp` 已有会话元数据拉取，标题从 events 首条用户消息或 session detail 取，取不到回退通用词）。
- `.chat-heading-actions` 分两组：`.chat-heading-info`（session-info-bar）与 `.chat-heading-tools`（runtime-picker + promote + stream-toggle），两组各自 `min-width: 0`，容器 `flex-wrap: wrap`，消除孤行。
- `EventStreamPanel` 头部删除重复的 session/events/run 信息条，只留「复制事件流」按钮与列表。

### D3 任务详情：详情态隐藏列表页头刷新

修复 C1：`TasksApp` 在 `selected` 非空时不渲染列表页头的刷新按钮（或整页头），详情页头刷新唯一。attempt 选择器 `max-width` 从 240px 放宽至 `min(320px, 100%)`。`noProjectionEvents` 改为「暂无时间线事件 / No timeline events yet」。

### D4 应用详情：空值隐藏与运行卡形态

修复 D1/D3/D4：manifest 卡 `dl` 中 skills/capabilities/inputs/dataSources 为空时不渲染对应行；发起运行卡在无 declaredInputs 且无多任务选择时不渲染 `form-actions` 分隔线（或整个 form 仅留提交按钮）；列表行版本号保留徽章、删副标题中的重复「最新版本 · vX」。

### D5 provider 弹窗迁移 Modal + 按钮主序

修复 E1/E2/D2：`workspace-providers.tsx` 的编辑弹窗迁移到 `fields.tsx` 的 `Modal`（面包屑「服务商 › 添加/编辑 provider」），`form-actions` 顺序统一为取消在左、主按钮在右；字段栅格将「适配器/基础 URL」与「模型」收敛为两行一致布局。`settings-nav` 增加 `aria-current` 与 active 背景。

### D6 定时任务错误态用全局 Banner

修复 F1：`schedules.tsx` 的裸 `banner banner-error` 替换为 `<Banner kind="error" …>`；认证错误保留配置指引文案。

### D7 壳层：折叠态堆叠 + 搜索中性文案 + 主操作错误出口

修复 G1/G2/G3：折叠态 `.sidebar-head` 改 `flex-direction: column`（印章在上、切换按钮在下）；搜索视觉位文案改为「搜索」+ `⌘K`（删除「任务」暗示）；`WorkspaceShell` 的 `NewChatButton` 增加错误态，经行内提示或复用现有 notice 通道展示。

### D8 时间格式

新增 `formatCompact`（`Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })`），`ChatSessionList` 行时间与任务/应用列表统一采用；长格式仅保留在详情页 hover title。

## Risks / Trade-offs

- [会话标题来源不统一（events vs detail）] → 优先用 session detail 的 title 字段；取不到回退通用词，不阻塞。
- [Modal 迁移改变 provider 弹窗 DOM 结构] → 测试同步更新；Esc/焦点圈定行为由 Modal 统一，回归由 `workspace-providers.confirm.test.tsx` 覆盖。
- [紧凑时间格式降低精确性] → 详情页/hover 保留完整时间戳。

## Migration Plan

纯呈现层修复，无数据/接口迁移。顺序：先修 P1（D1–D3、D5–D6），再 P2，最后补 spec 与测试。回滚：单 change revert。
