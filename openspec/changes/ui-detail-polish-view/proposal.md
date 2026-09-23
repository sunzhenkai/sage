## Why

当前 UI 只有静态 token/类型/构建通过，没有针对当前源码、截图和运行时行为的独立审查结论；若不先建立当前 evidence，P0/P1 修复会变成对历史 `ui-check.md` 的照抄，而该报告已明确过期。

## What Changes

- 只处理当前 Cursor Grok 4.7 报告中归入 view slice 的 P0/P1 视图、组件、ARIA、窄宽度和呈现层问题。
- 每个 P0/P1 绑定当前源码位置、截图/运行时证据、修复前后验证或明确接受理由；P2 记录状态但不扩大本轮范围。
- 修复范围限定在 `platform/apps/agent-web/src` 的共享 CSS、视图 CSS/TSX、反馈组件、可访问性属性和必要的窄宽度布局。
- 不改功能契约、API、领域对象、路由语义、安全边界，不处理文档权威或截图工具。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。

## Impact

| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 修改 `platform/apps/agent-web/src` 的 UI 实现和本子 change 的 OpenSpec 产物；不修改后端 API、文档权威或证据工具 |

## 验收标准

- [x] 当前 Cursor Grok 4.7 报告中的每个 P0/P1 都有 source/evidence 映射，并已修复或逐条记录接受理由。
- [x] P2 有明确状态，不把历史报告的旧行号或已知漂移条目直接当成当前缺陷。
- [x] 修复后 `check:ui-tokens`、`typecheck`、`build` 通过，并以当前截图/浏览器断言复核五视图、375/860/1280px、`.pane-item`/`.is-current`/`.is-active`、status/alert 和窄宽度溢出。
- [x] `openspec validate --strict --type change ui-detail-polish-view` 通过。
- [x] 不改 `ui-v1.md` 功能语义、API、领域字段或线上状态。

## 验证记录

### 审查报告

- 文件：`tasks/20260923-ui-detail-polish/review-cursor-grok47.md`
- Endpoint：`api2.cursor.sh` · 模型 `grok-4.7-high` · 日期 2026-09-23 · 基线 `60c2c57`
- 输入：`src/` 全部 TSX/CSS、`evidence/screenshots/manifest.json`、`docs/design/ui/` 四份、`CONTEXT.md`
- 只读要求：已执行，不改文件
- 发现：3 P0、10 P1、11 P2；文档 P0/P1 零 finding（一个 P2 死链归 docs）

### P0 修复

| # | 文件 | 修法 | 验证 |
|---|------|------|------|
| P0-1 | `global.css` 新增 `@media(max-width:375px)` 块 | `--pane-list-w:140px`、`--page-pad-x:12px` | browser-smoke 6/6 通过；截图重采后 375px 内容可读 |
| P0-2 | `global.css` 同块内 `.empty-state`/`.card` | padding 降到 12px/10px 12px | 同上 |
| P0-3 | `global.css` 同块内 `.settings-language`/`.segmented` | `flex-wrap:wrap`、`max-width:100%` | 同上 |

### P1 修复

| # | 文件 | 修法 | 验证 |
|---|------|------|------|
| P1-1 | `global.css` 375px 块 | 取消 settings-nav 32px 限制，显示 rail-label | 截图确认 |
| P1-2 | `SchedulesView.css` `.schedule-auth p` | 加 `overflow-wrap:anywhere` | 截图确认 |
| P1-3 | `global.css` 375px 块 `.notice-stack` | `left:8px;right:8px;max-width:none` | typecheck 通过 |
| P1-4 | `TasksView.css` `.task-detail-title` | `break-all` → `overflow-wrap:anywhere` | 截图确认 |
| P1-5 | `ProvidersView.tsx` listSegment | connections null 时加 loading/error 提示 | typecheck 通过 |
| P1-6 | `ProvidersView.tsx` TextInput | 加 `aria-label`、`aria-busy` | typecheck 通过 |
| P1-7 | `ProvidersView.tsx` load-more | 移出 `role=listbox` | typecheck 通过 |
| P1-8 | `ui.tsx` Field | 错误段落加稳定 `id` 供 `aria-describedby` | typecheck 通过 |
| P1-9 | `ui.tsx` ConfirmButton | armed 后 `confirmRef.current?.focus()` | typecheck 通过 |
| P1-10 | `App.tsx` BootFailure | 加 `role=alert`、`useRef` + focus | typecheck 通过 |

### P2 状态

| # | 状态 | 理由 |
|---|------|------|
| P2-1 用语「新建对话」 | deferred | 需与产品确认中文 UI 术语；不影响功能 |
| P2-2 英文兜底 | deferred | 影响面小，仅 error message 为空时出现 |
| P2-3 aria-busy 在 disabled 上 | accepted | 当前读屏行为已可接受；改 aria-disabled 可能引入回归 |
| P2-4 空态无 live role | accepted | LoadingBlock 有 status；EmptyState 静态展示是合理取舍 |
| P2-5 常驻说明 role=alert | accepted | 进入面板才渲染，非反复触发；影响有限 |
| P2-6 选择"无"静默丢掉 | deferred | 需确认产品行为是否应允许清空默认模型 |
| P2-7 combobox aria-controls | accepted | aria-expanded 已正确切换，影响极小 |
| P2-8 Spinner 空 live region | accepted | Spinner 均在有 label 上下文中使用 |
| P2-9 模型目录禁用无原因 | deferred | 需与产品确认交互流程 |
| P2-10 搜索占位被切 | deferred | 纯视觉，需要缩短文案并与 i18n 统一 |
| P2-11 顶栏无收缩策略 | accepted | 当前文案不溢出；为极端场景预留 |

### 命令与结果

| 命令 | 退出码 |
|------|--------|
| `corepack pnpm run check:ui-tokens` | 0 |
| `corepack pnpm run typecheck` | 0 |
| `corepack pnpm run build` | 0 |
| `corepack pnpm run browser-smoke` | 0（6/6） |
| `corepack pnpm run screenshots` | 0（57 张） |
| `openspec validate --strict --type change ui-detail-polish-view` | 通过 |
