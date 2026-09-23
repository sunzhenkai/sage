## Why

`agent-web` 缺少统一的布局与呈现契约：功能契约 `docs/design/ui/ui-v1.md` 明文排除呈现层、实现 prompt 声明"样式是自由度，不是验收项"，导致五视图出现三套 master-detail 模式、4 套选中态、3 套 hover、9 档字号与每视图自定间距；另有 4 项 P0 可访问性问题（对比度不达 WCAG AA、会话行 `<a>` 嵌 `<button>`、Modal 焦点与丢数据、aria 硬编码英文）。使用者已裁决统一的三段式布局契约（rail → 列表栏 → 内容区），且「模型与连接」并入设置视图的独立改动已落地（`14a3f7e`，主菜单收敛为五视图），现在是把布局契约固化为规格并整修已知缺陷的时机。本变更的完整审计已经 cursor + grok-4.7 评审（22 条建议全采纳），其结论固化于 `design.md` 的决策记录与 `docs/design/ui/layout-v1.md`。

## What Changes

- **三段式布局契约落地**：五视图统一为「层 1 rail 主菜单（卡片外，208px）+ 层 2 列表栏（卡片内，320px，≤860px 时 220px）+ 层 3 内容区（1fr，内部滚动）」；topbar 位于卡片内、只横跨层 2/3，承载视图标题 + 全局「新建对话」+ 至多一个视图级主按钮。
- **列表栏统一规格**：新增 `.pane-item` 三态规格（静息 / hover / `is-current`，逐字对齐 Chat 会话行现码），全视图唯一选中类 `is-current`，选中态同时反映在 URL 与 `aria-current`；设置视图列表栏为「子菜单段（通用 / 模型与连接）+ item 段（连接列表）」双段结构。
- **视图迁移**：Tasks 去除 `.is-list-only` 单列分支；Packages 由替换式整页切换改为并排常驻；Schedules 由卡片行内展开改为并排并新增 `schedule=<id>` 查询参数；设置·模型与连接面板内连接选中态新增 `connection=<id>` + `panel=model` 查询参数；删除全部「返回列表」链接（3 处）。
- **P0 可访问性整修**：新增 `--faint-text` token 并切换 4 处文字用途（`--faint` 保留给边框）、`--amber` 压深至 AA 达标；会话行拆掉 a>button 嵌套与 preventDefault 补丁；Modal 焦点环 + 焦点归还 + 表单脏检查；aria-label 中文化（`shell.nav.workspace` 新 key）。
- **反馈与文案**：通知栈合并为右下单栈（错误保持独立 alert live region、不可被数量上限挤掉）；Task 控制成功文案不再误用「已保存」；空态文案按"标题+说明+可选动作"补齐，中英字典成对。
- **Token 与动效收敛**：新增 `--pane-list-w` / `--page-pad-x` / `--page-pad-y` / `--pane-gap` / `--dur-fast` / `--dur-slow`；Badge 元数据用途改灰阶 plain 变体；表格加横向滚动容器。
- **契约沉淀**：新建 `docs/design/ui/layout-v1.md` 作为呈现层验收依据，对冲实现 prompt 的"样式非验收项"遗留表述；`ui-v1.md` §3.1 查询表登记新参数。
- 无 API/后端变更；`schedule=`、`connection=`、`panel=` 为纯前端查询参数（ADDITIVE）。

## Capabilities

### New Capabilities

- `agent-web-shell`: agent-web 三段式布局契约与 UI 反馈行为——壳层三列结构与职责分工、列表栏 item 规格与选中态 URL 语义、视图级主按钮与列表栏头约束、内容区空态、反馈通知栈的 live region 语义、可访问性基线（对比度、焦点管理、本地化 aria）、设计 token 与动效约束。

### Modified Capabilities

（无——`openspec/specs/` 下现有能力均为后端/运行时行为，本变更不改变其需求；呈现层此前不存在规格，故为新增能力。）

## Impact

- **代码**：`platform/apps/agent-web/src/` — `App.tsx`（topbar 插槽）、`components/ui.tsx`（Modal 焦点、SearchBox、Badge plain、ConfirmButton aria）、`components/Feedback.tsx`（单栈通知）、`styles/global.css`（token 与 `.pane-item`）、`views/` 全部五个视图的 TSX/CSS、`lib/router.ts`（`schedule`/`connection`/`panel` 参数）、`i18n/zh-CN.ts` 与 `en.ts`（成对新增 key，`Messages = typeof zhCN` 同构为 typecheck 硬条件）。
- **文档**：新增 `docs/design/ui/layout-v1.md`；更新 `docs/design/ui/ui-v1.md` §3.1 查询表、`platform/apps/agent-web/README.md` 视觉基线段。
- **不受影响**：`@sage/app-contracts` 类型、agent-api 后端、`scripts/dev-mock.mjs` 协议。
- **依赖关系**：以 HEAD `14a3f7e`（五视图归并已落地）为基线；原审计计划 Phase 2.4 的依赖门控由此解除，但其行号需按执行时 HEAD 复核。
