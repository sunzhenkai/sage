## Context
PackagesView 的 `.pkg-row` 用横向 `space-between` 且 `.pkg-row-meta` 为 `white-space: nowrap`，320px（≤860px 时 220px）列表栏放不下名称、id、Releases、版本与中文 medium 日期；全局隐藏滚动条使溢出不可见。同视图三张表的 `<th>` 直接写字面量英文。

## Goals / Non-Goals
**Goals:**
- 列表行结构与既有 `.task-row` / `.schedule-row` 纵向模式对齐，消除契约宽度内溢出
- 表头与标题全部走 zh-CN / en 词条

**Non-Goals:**
- 不改其他视图；不引入新依赖

## Decisions
- 纵向行复用现有 `.task-row` 的结构约定，而不是给 `.pkg-row` 加横向压缩或省略号截断（截断会隐藏版本/时间信息）
- 日期展示与会话列表一致改用短格式（`MM-DD HH:mm` 一类），理由：medium 中文日期是溢出主因
- `minmax(240px, 1fr)` 改 `minmax(0, 1fr)`，让 grid 受内容区约束

## Risks / Trade-offs
- [日期改短格式后失去年份信息] → 与会话列表同一取舍；跨年条目可依赖详情区完整时间
