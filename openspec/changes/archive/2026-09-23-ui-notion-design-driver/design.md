## Context

`docs/design/ui/design-language.md` 是用户确认的类 Notion 目标设计方案；`docs/design/ui/layout-v1.md` 目前把园丁台视觉写成 active 契约，`platform/apps/agent-web/src/styles/global.css` 是当前实现。`ui-v1.md` 只约束功能行为，`ui-v1-frontend-prompt.md` 仍含失效的样式自由条款。当前实现同时含 `global.css` 和 Chat/Tasks/Packages/Providers/Schedules/Settings 六份视图 CSS，尚无 UI 自动化测试或 stylelint。

## Goals / Non-Goals

**Goals:**

- 让 `design-language.md` 成为唯一目标视觉权威，并把目标值映射为可复用 CSS token。
- 保留 `ui-v1.md` 的功能行为、状态机、错误语义、API 和可访问性行为；视觉迁移不得改变这些契约。
- 保留五视图、三段式结构、层 2 列表、`.pane-item` 三态、`.is-current` 列表选中和仅亮色约束，把园丁台视觉替换为类 Notion 中性灰/白底/淡色语义状态。
- 让 `layout-v1.md` 只描述结构、交互和验收边界；把视觉 token、状态色、字体、圆角、阴影、动效事实归入目标设计与 `global.css` 的映射。
- 建立从 `design-language.md` 到 `global.css` 和视图样式的 current/target/delta 迁移账本，以及可在本地重复执行的 token/样式检查和截图验收。
- 收敛文档权威关系：功能契约、目标视觉、结构契约、运行时 token、历史 prompt、一次性 findings 各自只有一个职责。

**Non-Goals:**

- 不改后端 API、Chat/Task/Run/Session 领域语义、数据库 schema、安全边界或运行时协议。
- 不新增业务页面、路由结构、命令面板、看板、keycap 等目标设计中仅作为视觉样本出现的功能。
- 不引入第三方 UI 框架、暗色主题、换栈或新的产品功能。
- 不删除历史参考内容；只改变其状态、边界和引用方式。
- 不把 `ui-check.md` 当作当前实现缺陷清单，也不依据其旧行号回滚已修复代码。
- 不为规则口号写 linter；只检查可指向 token、CSS、常量、DOM 语义或明确判定程序的约束。

## Decisions

1. **权威分层。** `ui-v1.md` 是功能行为权威；`design-language.md` 是目标视觉权威；`layout-v1.md` 是结构/交互契约；`global.css` 是运行时 token 与迁移实现事实。任何冲突按“功能语义 > 结构/交互 > 目标视觉 token > 当前实现事实”处理，并在迁移清单标注 gap。
2. **目标 token 先冻结，再迁移组件。** 以 `design-language.md` 已确定的中性灰、蓝/琥珀/绿/红语义色、4/6/8/10/12/16px 圆角阶梯、12/13/14/16px 字号阶梯、平面结构/悬浮层阴影策略和 150–200ms 轻量动效为输入，先形成 target token 表，再替换 `global.css` 的 `:root`。避免同时改 token 与组件造成不可定位回归。
3. **结构不变、皮肤迁移。** `.pane-item`、`.is-current`、三段式布局、查询参数选中、`aria-current`、通知 status/alert 和五视图路由保持不变；颜色、边框、密度、圆角、阴影、图标线宽、空态和动效按目标设计重写。导航/分段控件的 `.is-active` 是交互语义，不与列表选中类混用。
4. **状态色由目标语义映射。** 将目标的蓝完成、琥珀进行/警告、绿审核/成功、红阻塞/失败、灰待办映射到 badge、通知、焦点环、危险操作和列表选中；不沿用当前 sage/clay/steel 色相作为最终视觉身份。
5. **组件边界只迁移已有 surface。** 目标设计里的命令面板、看板列、任务卡、keycap 等作为视觉语言样本保留，不因文档提及而新建产品功能；只对当前导航、列表、表单、按钮、表格、通知、徽标、加载、空态、详情、聊天输入和响应式壳层落地。
6. **验证从窄到宽。** 先加确定性检查：目标 token 在 CSS 中的唯一定义、旧园丁台 token/色相残留、禁止的平面阴影、动效 keyframe 与 `prefers-reduced-motion`、关键 ARIA/选中语义；再做 Playwright 五视图 375px/860px/1280px 截图和状态样本；最后做 cursor + grok-4.7 diff review。
7. **实现按三个可独立验收的子 change 切片。** `ui-notion-design-docs` 处理文档权威、目标 token 映射和迁移账本；`ui-notion-design-system` 处理 `global.css` 与共享组件；`ui-notion-design-views` 处理六个视图 CSS/必要组件适配、视觉证据和回归。三者均在同一 planning root，文件范围不重叠或按声明顺序执行。

## Risks / Trade-offs

- [目标值来自读图近似，部分语义色/圆角/字号需要冻结为正式值] → 在 `design-language.md` 建立 target token 表，冻结后才允许进入组件迁移；不再在实现中自行取近似值。
- [把园丁台 token 全量替换可能同时改变对比度、焦点环、状态识别和布局密度] → 先只替换 token 和状态色，保留语义类名和结构；每个视图截图状态至少覆盖 normal/hover/selected/loading/empty/error。
- [`ui-v1.md` 把可观察 UI 语义写进功能契约，可能与视觉迁移边界混淆] → 只收窄“纯视觉非范围”表述，保留 status/alert、语言入口、时间格式和当前视图可辨识等功能验收。
- [旧 prompt、README、layout 三处历史说明互相矛盾] → 一次改动同时更新文件自身状态、README 索引和 `layout-v1.md` 历史说明；验收检查禁止“样式自由/明确不设限”作为有效指令。
- [当前无 UI 测试基础设施，截图证据容易手工漂移] → 先落地窄脚本和固定视口/固定 mock 数据的截图清单；缺浏览器时记录阻塞，不以构建通过替代视觉验收。
- [类 Notion 目标里包含当前不存在的组件样本] → 只映射已有 surface；把未采用组件记录为 non-goal，防止验收范围被文档撑大。
- [视觉迁移容易误伤 i18n/API 标识和领域术语] → 迁移只改呈现层 CSS/组件皮肤；`runId`、`taskId`、manifest `entry`、query 名和功能 API 不动。

## Migration Plan

1. **契约冻结：** 在 `design-language.md` 新增 target authority、正式 target token 表、目标/当前/差异清单和非采用组件边界；在 `layout-v1.md` 删除园丁台主题身份和失效动效/选中类断言，改为结构契约；在 `ui-v1-frontend-prompt.md`、`ui-v1.md`、README、`CONTEXT.md`、`ui-check.md` 收敛状态和权威。
2. **系统迁移：** 在 `global.css` 保留布局变量，替换主题色、灰阶、边框、状态色、圆角、阴影、字体和动效 token；同步 `.pane-item`、`.rail-link`、按钮、输入、badge、notice、spinner、modal、empty/error 等共享组件；运行窄静态检查。
3. **视图迁移：** 按 Chat、Tasks、Packages、Providers、Schedules、Settings 顺序调整视图 CSS 与局部语义皮肤，保持路由/状态/数据流不变；对每个视图记录 screenshot evidence 和 gap 关闭情况。
4. **回归收口：** 运行 `typecheck`、`build`、target token 检查和 375/860/1280px 截图清单；修正 P0/P1 视觉 finding；用 cursor + grok-4.7 review 迁移后的文档和 diff，接受项必须写理由。
5. **回滚：** 每个子 change 独立提交；若目标视觉导致功能/可访问性回归，优先回滚对应子 change 的皮肤层，不回滚 `ui-v1.md` 功能语义、不把旧 prompt 重新设为有效规范。线上发布不在本计划内。

## Open Questions

- 目标语义色和圆角/字号的精确值需在第一阶段按 `design-language.md` 的近似值冻结；冻结后不再等待额外选择。
- 视觉截图使用 Playwright 固定视口和 dev mock；若当前环境无法运行浏览器，则把截图任务保持未勾并记录阻塞，不以 `build` 成功替代。
