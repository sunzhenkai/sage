---
roles: design
reviewer: role-based-reviewer/design (DeepSeek V4.1 Flash subagent, 只读)
implementer: agent-web-i18n-implement worker (W1–W7)
report: platform/.evidence/agent-web-i18n/ui/w7/report.json
---

# design 评审（UI/UX 六子项 + 视觉/无障碍/响应式）

评审对象：agent-web 中英双语交付（dirty 摘要 sha256 `e004dbf1…`，未跟踪集合 sha256 `e2d67e86…`，66 文件；taskrail 硬边界，无 commit）。
证据：`platform/.evidence/agent-web-i18n/ui/w7/`（10 路由态 × 2 视口，axe_blocking=0 / focus_invisible=0 / ok=true，20 张 PNG 实际尺寸与声明视口一致）+ 本评审在 9644 实例上的 DOM 实测。
基准物：WCAG 2.2 AA（axe 地板）+ 交付仓 `DESIGN.md` / `check:design`（adopt-only，豁免 Active Instance，已 confirmed）。未引入外部产品基准。

## 结论

- 桌面（1280x800）两语：不无问题——层级、token、语义色、状态覆盖、对比度校准均达标（见下）。
- 375x812：**不达标**。不是「观感拥挤」，而是实测内容被 `overflow-hidden` 裁切且不可滚动、设置页语言与主题控件完全不可达（详见 D-1）。
- 六子项：信息架构 / 视觉层级 / 反馈 / 无障碍 通过；关键状态 部分通过（B 类登记）；**响应式 0 分**（判据原文含 375x812「渲染可用」）。

## findings

### D-1（Major，响应式；design 主责，product 协作）

375x812 下主内容区被裁切且不可达，设置页「语言」控件在证据视口内不可用。
证据（本评审在 `http://127.0.0.1:9644` 实测，同一工作树）：

- 侧栏固定 `w-[220px]` 无断点（`platform/apps/agent-web/src/components/layout/app-shell.tsx:55`），占 375px 的 58.7%；内容视口 `overflow-hidden`（`app-shell.tsx:128`）。
- 375px 实测：`aside=220`，panel client 147px；panel `scrollWidth` = chat 424 / settings 348 / overview 178，而 `documentElement.scrollWidth` 仍为 375 → 溢出部分既不显示也无法滚动，信息直接不可达。
- `/settings/appearance`：语言控件「自动 / English / 中文」实测 `left=586..732`、主题控件 `left=586..712`，均在 375px 视口外且不在 panel 内 → 指针不可达（`src/pages/settings.tsx:74-80`）。
- 键盘侧：Tab 可达的设置子导航项（外观/快捷键/连接/供应商/状态/开发者）实测 `left=230, right=509`，右边界在视口外 → 焦点落在不可见区域（报告 `focus_walk.invisible=[]` 未能发现，因该工具只校验 `:focus-visible` + outline，不校验视口内可达；且走查被 `tab_steps=15` 截断，见 E-1）。
- 与判据的关系：完成判据原文含「设置页可手动切换并持久化」与「1280x800 与 375x812 渲染可用」；375px 下前者物理不可达 → 判据未达成，非纯观感问题。
- 归因说明（不改变结论）：`w-[220px]`、`overflow-hidden`、`grid-cols-2` 均为改动前既有写法，本次 diff 未引入；本次只是首次把 375x812 写进可验收判据。
- 建议 disposition（二者择一，先定项再修）：
  1. **修**（推荐，成本可控）：在 `AppShell` 加窄屏断点（如 `<768px` 侧栏折叠为 56px 图标态或抽屉），并给 `SubPane`/`w-[var(--w-subpane)]` 与 chat 分栏加窄屏堆叠；改完只需复跑 `ui_evidence_check`（`tab_steps ≥ 60`）。
  2. **改判据**：若坚持桌面优先，需用户确认把 375x812 条款改为「窄屏仅保证渲染与 axe，不保证内容可达」——属 A 类（判据原文由用户确认），必须先确认再记 `accepted-recorded`。
- 复核方式：375px 下断言 `panel.scrollWidth === panel.clientWidth` 且语言控件 `right ≤ 375`。

### D-2（Major，无障碍/证据联动；design 协作，engineer 主责）

`focus_walk` 对「本次新增的唯一交互控件」没有有效覆盖。
证据：`platform/evidence/agent-web-i18n/ui-manifest.json:11,22,33,…` 每个 route 均为 `tab_steps: 15`；`report.json` 各路由 `focus_walk.order` 恰好 15 项且 10 个路由完全同构（侧栏导航 + `Mock 数据 · 只读`），说明走查在进入页面内容前即耗尽步数 → 设置页语言/主题切换、任务切换控件、聊天输入框等从未被走查，`invisible=[]` 不能作为「页面控件焦点可见」的证据。
建议 disposition：把 `tab_steps` 提到 ≥60 复跑（同一 manifest 即可），或如实登记为 B 类「焦点走查仅覆盖侧栏」。属证据补强，不改产品行为。

### D-3（Minor，证据/登记准确性）

`overview/chat/tasks/providers` 的 `not_applicable.loading` 理由写「mock 数据同步返回，页面无稳定加载窗口」，但 `platform/apps/agent-web/src/lib/api.ts:34` 在 mock 模式下有 `setTimeout(...,120)`，且各页确有 `isLoading → <Loading/>`（如 `src/pages/tasks.tsx:57`）→ 加载态客观存在，只是窗口短。建议改为「mock 存在约 120ms 异步窗口，截图不确定可复现」，或补一张 `loading` 证据。

### D-4（Minor，登记一致性）

`platform/apps/agent-web/README.md:73-74` 把 375px 记为 “layouts are tight while the sidebar is open”，弱于实测（内容裁切 + 控件不可达）。建议按 D-1 的结论修订措辞，避免下游把它当观感问题。

### D-5（Minor，既有问题，本轮未覆盖）

`--accent` 作为正文字色时低于 AA 地板：浅色 `oklch(0.626 0.205 254.947)` 对 `--panel`≈3.39:1、对 `--surface`≈3.62:1，使用点 `src/pages/providers.tsx:235`、`src/pages/tasks.tsx:135`、`src/components/ui/misc.tsx:82`、`src/components/ui/status.tsx:20`；这些点分布在任务详情、供应商编辑表单、错误态（后者正是 `not_applicable.error`）→ 10 张证据截图覆盖不到，axe 0 违规不能外推到它们。本轮校准改了 `--ink-3/--accent-ink/--green/--orange/--red`（`src/index.css:14,17-20`），未动 `--accent`。建议把上述正文用点换 `--accent-ink`（每处一行）或登记 B 类；不阻塞本次判据。

### D-6（Minor，未覆盖项）

dark 主题无门禁证据（调用方已声明）。本评审按 token 实算：dark `--ink-3` 对 `--hover-2` = 3.80:1、`--red` 对 `--hover-2` = 3.86:1（<4.5），对 canvas/page/surface 均 ≥4.6:1。若后续把 dark 纳入证据集，请优先复查选中行/悬浮行上的 ink-3 与 red 文案。

## 六子项逐项结论

1. **信息架构**：通过。侧栏分组（智能体/配置）、设置二列结构、页头层级未被本次改动改变；术语与 `tasks/ongoing/agent-web-i18n/glossary.md` 一致（概览/对话/任务/定时任务/应用/发布包/供应商/设置），截图与词典逐条对得上。
2. **视觉层级**：通过（1280）。DESIGN.md §1/§3（`DESIGN.md:13,82`）要求「筛选/切换放在头部下方工具行」，W7 把 overview 范围切换与 tasks 视图切换从 `PageHeader.tabs` 移入 `PageToolbar`（`src/pages/overview.tsx`、`src/pages/tasks.tsx`），与既有 `PanelBar` 语义一致且 `check:design` 绿；语义色未被破坏（成功=绿、失败=红、警告=橙，`src/components/bui/atoms.tsx:18`）。
3. **关键状态**：部分通过。success 双语境覆盖；loading/empty/error 仅登记 `not_applicable`（代码侧四态齐全，如 `tasks.tsx:57`、`chat.tsx:53-58`、`apps.tsx:31`）。按 B 类登记处理，理由见 D-3。
4. **反馈**：通过。设置保存/重置有行内反馈（`src/pages/settings.tsx:128-129`、`:44`）、请求态有 spinner/disabled；本次未删改任何反馈路径。
5. **无障碍**：通过（附 D-2 证据限制）。axe(WCAG 2.2 AA 标签集) 10/10 路由态 0 违规；焦点走查 `invisible=0`；新增/修补的 aria-label 合理（`src/components/charts/index.tsx` Heatmap `tabIndex`+`aria-label`、providers 下拉），运行态文字改用 `--accent-ink`（`src/components/bui/session-list.tsx:11`）后对比度达标；校准后 token 实算（light）：`ink-3/accent-ink/green/orange/red` 对 canvas≈4.59–4.61、page 4.90–4.92、surface 5.24–5.25、field 4.67–4.69，满足 ≥4.5 声明。
6. **响应式**：**0 分**。375x812 靠压缩硬塞且内容不可达（D-1）；1280x800 无溢出（实测 `scrollWidth==clientWidth==1052`，0 个越界元素）。

### 总结与置信度

高 — 结论全部绑定 `path:line`、report 产物与本机 DOM 实测；唯一低置信侧是 dark 主题结论（无运行态证据，仅 token 实算，已在 D-6 标注）。
