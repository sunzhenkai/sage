## Context

See proposal.md - Why. 现状：`WorkspaceShell` 在 `platform/apps/agent-web/src/main.tsx` 以固定宽度 `244px`（≤980px 为 207px）渲染左侧 `aside.sidebar`，`main-column` 以 `margin-left` 对齐；侧边栏无任何收起/展开能力。移动端（≤700px）已通过 media query 把侧栏转为顶部横向导航。

## Goals / Non-Goals

Goals:
- 桌面端侧边栏可在「完整侧栏」与「仅图标列」间切换，选择持久化到浏览器本地存储
- 收起切换为纯客户端状态变化，不触发整页重载，不改变视图渲染
- 复用既有 `client-side-routing` 语义：侧栏导航仍是 `<a href>` + 客户端路由，收起不影响导航行为

Non-Goals:
- 不做 hover 自动展开、拖动调整宽度、分组折叠等额外交互
- 不在移动端（≤700px）引入收起能力
- 不改动 `workspace-status-presentation` 声明的「用户账户区位于侧边栏底部」约束（收起态隐藏其文字，保留占位）

## Decisions

### 1. 用 `collapsed` 布尔状态 + CSS class 表达形态，而不是两套 DOM

WorkspaceShell 增加 `collapsed` state（初始值从 localStorage 读取），在 `aside.sidebar` 上加 `is-collapsed` class；文本节点以 CSS（`display:none`）或条件渲染隐藏，宽度由 class 切换。理由：单个 class 切换可复用现有 media query 断点（`@media (max-width:700px)` 顶部导航维持不变），且样式集中在一个文件里，符合当前 styles.css 单文件约定。

备选：渲染两份 DOM 各自控制显隐 —— 会造成可访问性重复与维护负担，弃用。

### 2. localStorage key 独立定义，参照 `LOCALE_STORAGE_KEY` 模式

在 `main.tsx`（或 locale.tsx 同层）定义 `SIDEBAR_STORAGE_KEY`，用 `localStorage.getItem/setItem` 读写；读写失败（隐私模式等）静默回退为不持久化，与 locale 的 best-effort 持久化一致。

备选：并入 URL query —— 会污染 canonical URL 语义（`client-side-routing` 对 query 有严格约定），弃用。

### 3. 收起态隐藏文本采用「内容仍可被辅助技术访问」

品牌、导航文字等通过 `aria-hidden` + 视觉隐藏（`.visually-hidden` 或收缩时 `display:none` 的 class）处理；导航项用 `title`/`aria-label` 补齐可访问名称，满足 spec 的「图标化导航项具有可访问名称」。

备选：收起态直接去掉文本节点 —— 重构 DOM 结构代价更高且与展开态重复，弃用。

### 4. 切换入口放侧边栏顶部品牌区

在 `brand` 行内（或紧邻其下）放置一个 icon button（`aria-expanded`、双语 aria-label、`title`），收起/展开同键切换。理由：常驻可见、不挤占底部用户区（底部用户区布局约束保持不动）。

## Risks / Trade-offs

- 收起后侧栏宽度变小，`main-column` 需同步用 CSS class 调整 `margin-left`/`width`，若与 `@media (max-width:980px)` 的 207px 规则叠加需确定优先级 → 以 `is-collapsed` class 显式覆盖（class 特异性高于 media 内的 `.sidebar`/`.main-column` 规则或写入同一 media 块内），并在测试中断言两种断点下的类名。
- localStorage 不可用时行为退化为「每次进入展开态」 → 与 locale 的 best-effort 一致，属可接受降级，spec 只承诺「持久化」为尽力而为。
- 收起态下用户可能忘记侧栏存在、找不到导航文字 → 图标保留 + 激活态高亮 + 可访问名称兜底，符合 spec 契约。

## Migration Plan

纯前端交互改动，无数据迁移、无服务端契约变化。可随 agent-web 常规发布；回滚即还原 `main.tsx` / `styles.css` / `locale.tsx` 三处改动，不影响既有行为（未加 class 时样式与现在一致）。

## Open Questions

无。
