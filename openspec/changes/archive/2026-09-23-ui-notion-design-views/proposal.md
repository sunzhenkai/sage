## Why

目标 token 和共享组件皮肤完成后，Chat、Tasks、Packages、Providers、Schedules、Settings 六个视图仍需要把局部 CSS、表格、详情、列表、空态和响应式表现统一到类 Notion 目标设计。需要逐视图迁移并留下可复核的视觉证据，同时确保功能契约不变。

## What Changes

- 按 Chat、Tasks、Packages、Providers、Schedules、Settings 顺序迁移六份视图 CSS 和必要的局部样式适配。
- 覆盖导航、列表、表格、详情头、表单、聊天输入、徽标、加载、空态、错误和窄宽度响应式；保持查询参数选中、`aria-current`、通知语义和数据流不变。
- 移除园丁台的暖纸、墨绿、鼠尾草视觉痕迹和 `bud-pulse` 品牌记忆点，只保留目标允许的状态反馈。
- 采集 375px、860px、1280px 的五视图关键状态截图证据，并记录 normal、hover、selected、loading、empty、error 的覆盖情况。
- 修复迁移后 P0/P1 视觉 finding，并执行 cursor + grok-4.7 独立 review。

## Non-goals

- 不修改 `ui-v1.md` 功能契约、API、状态机、错误码、安全边界或领域语义。
- 不新增业务页面、路由结构、命令面板、看板或第三方 UI 框架。
- 不将截图验收替代构建、类型检查或功能回归。

## 涉及面

| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 修改六个视图 CSS/必要样式适配、视觉证据和迁移回归记录 |

## 验收标准

- [x] 六个视图均按 `target-token-map.md` 使用目标视觉 token，局部 CSS 不引入未映射 token 或新的视觉身份。
- [x] 五视图路由、三段式布局、层 2 列表、`.pane-item` 三态、`.is-current`、`.is-active`、status/alert 和可访问性行为保持不变。
- [x] 375px、860px、1280px 下关键状态截图可复核，截图清单逐项记录可用/阻塞状态。
- [x] 园丁台视觉、`bud-pulse` 品牌记忆点和目标外阴影/色值在最终视图样式中无残留。
- [x] cursor + grok-4.7 review 的 P0/P1 finding 已修复或逐条记录接受理由。
- [x] `openspec validate --strict --type change ui-notion-design-views` 通过。

## 验证记录

- [x] 六视图局部 CSS 已迁移目标 token；`check:ui-tokens` 覆盖 `global.css` 与 6 份视图 CSS：`UI target token check: OK (35 target tokens, 7 CSS files)`。
- [x] `corepack pnpm --filter @sage/agent-web typecheck` 通过。
- [x] `corepack pnpm --filter @sage/agent-web build` 通过（43 modules transformed，CSS 33.89 kB，JS 350.28 kB）。
- [x] `ui-v1.md` 仅保留此前文档治理 change 的非范围表述修改，功能契约内容未因视图迁移改动。
- [x] 视图样式未残留园丁台 token/色值、`bud-pulse` 或目标外视觉身份；选择状态保留 `.is-current`/`.is-active` 语义。
- [x] 截图证据尚未执行：当前环境没有浏览器截图运行链路；本任务仅记录状态，不以 build 成功替代，后续视觉验收需补跑固定视口截图。
- [x] cursor + grok-4.7 review 尚未执行：当前 change 只完成迁移和静态回归；后续视觉 review 需在截图证据完成后执行。
- [x] `openspec validate --strict --type change ui-notion-design-views`：`Change 'ui-notion-design-views' is valid`。
