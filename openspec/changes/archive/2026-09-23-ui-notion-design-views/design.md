## Context

目标视觉、迁移清单和共享系统 token 由前置 change 提供；当前 Chat、Tasks、Packages、Providers、Schedules、Settings 六个视图各有局部 CSS，仍有局部颜色、字体、圆角、阴影和园丁台动效痕迹。五个产品视图由路由和 `ui-v1.md` 管理功能行为，必须保持状态机、API、错误语义、查询参数选中和可访问性行为。本 change 只负责视图皮肤、视觉证据和迁移回归。

## Goals / Non-Goals

**Goals:**

- 按 Chat、Tasks、Packages、Providers、Schedules、Settings 顺序把六份视图 CSS 迁移到 `target-token-map.md` 的目标视觉。
- 覆盖导航、列表、表格、详情头、表单、聊天输入、徽标、加载、空态、错误和 375/860/1280px 响应式表现。
- 保留五视图路由、三段式布局、层 2 列表、`.pane-item` 三态、`.is-current`、`.is-active`、status/alert 和 ARIA 语义。
- 采集关键状态截图证据，修复迁移后 P0/P1 finding，并完成 cursor + grok-4.7 review。

**Non-Goals:**

- 不改 `ui-v1.md` 功能契约、API、状态机、错误码、安全边界、领域语义或数据流。
- 不新增业务页面、路由结构、命令面板、看板、keycap 或第三方 UI 框架。
- 不把截图验收替代 `typecheck`、`build` 或功能回归。
- 不回退到园丁台暖纸/墨绿/鼠尾草视觉身份。

## Decisions

1. 视图层只消费 system/target token，不新增视觉 token；局部 CSS 只负责布局和少量 surface 适配。
2. 迁移顺序按 Chat → Tasks → Packages → Providers → Schedules → Settings，前一视图完成关键状态检查后再继续，便于定位视觉回归。
3. 保留查询参数驱动的 `.is-current` 列表选中和 `aria-current`；导航、分段控件、combobox 的 `.is-active` 保持交互语义，不合并为列表选中类。
4. 目标语义状态映射：neutral 待办/取消、warning 进行/警告、success 成功/审核、info 完成/链接/焦点、danger 失败/阻塞/危险。
5. 证据采用固定视口和固定 dev mock 数据，状态至少覆盖 normal、hover、selected、loading、empty、error 中可用项；无浏览器时记录阻塞，不用构建成功替代。
6. cursor + grok-4.7 只读 review 迁移后的文档和 diff；P0/P1 必须修复或写明接受理由，P2 可在验证记录中跟踪。

## Risks / Trade-offs

- [局部样式覆盖 system token] → 视图 CSS 检查禁止新增视觉 token/硬编码色值，允许布局和响应式值但需记录理由。
- [状态截图受 mock 数据影响] → 固定 dev mock 状态和视口，记录数据 fixture 与 URL；不将不可达状态误判为缺陷。
- [功能回归容易被视觉 diff 掩盖] → 每个视图先跑功能/类型/构建回归，再采集截图；只改 CSS/皮肤文件。
- [窄宽度表格和详情头溢出] → 保持 `table-scroll`、标题换行和响应式壳层，截图覆盖 375px/860px。
- [目标设计中的未采用组件被误实现] → 只迁移现有 surface，样本组件记录为 non-goal。
- [视觉 review 发现文档或 token 设计问题] → 不在 view change 中改目标契约，回到 docs/system change 修正后再迁移。

## Migration Plan

1. 建立视图迁移状态表：Chat、Tasks、Packages、Providers、Schedules、Settings 的 surface、target token、证据状态和 gap。
2. 按 Chat、Tasks、Packages、Providers、Schedules、Settings 逐个迁移局部 CSS 和必要组件皮肤。
3. 每个视图完成后采集 375px、860px、1280px 关键状态截图，并记录 normal/hover/selected/loading/empty/error 覆盖。
4. 运行 `typecheck`、`build`、system token 检查和功能回归；确认 `ui-v1.md` 语义不变。
5. 执行 cursor + grok-4.7 review，修复 P0/P1 finding 或记录接受理由。
6. 归档视图 change 前回填迁移状态表和证据路径；发现系统问题则暂停并转回对应 change。

## Open Questions

- 无。视图范围、迁移顺序、截图视口和状态集合已在任务清单中冻结。
