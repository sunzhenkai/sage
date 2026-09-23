## Context

`agent-web`（React 19 + Vite + TS + 手写 CSS，无 UI 库）以 HEAD `14a3f7e` 为基线：五视图（chat/tasks/packages/schedules/settings）已收敛，「模型与连接」以 `SettingsTab = general | connections` 内嵌于设置视图（`SettingsView` 直接渲染 `ProvidersView`）。呈现层此前无规格（`ui-v1.md` 排除呈现层、实现 prompt 声明"样式是自由度"），布局由各视图自由生长。完整审计、评审（cursor + grok-4.7，22 条）与逐条修订记录见 `design-plans/001-agent-web-three-pane.md`（v2）及其 `reviews/` 回执；本文件只固化实现取舍，行为契约见 `specs/agent-web-shell/spec.md`。

约束：

- 功能语义零变更：不改 API、不改 `@sage/app-contracts`、不改 SSE/AbortController 生命周期；`ui-v1.md` 的提交式会话搜索、语言入口三处、全局新建对话必须保持。
- CSS 注入顺序：`main.tsx` 先引 `App` 再引 `global.css`，同特异性时全局胜出——现状多处以双类对抗（`TasksView.css`、`SettingsView.css` 注释已写明）。
- `i18n/index.tsx` 的 `Messages = typeof zhCN` 使中英字典同构成为 typecheck 硬条件。
- 仓库存在多会话并发改动历史：一切行号引用以执行时 HEAD 复核为准。

## Goals / Non-Goals

**Goals:**

- 五视图统一到三段式布局契约，选中态/URL/hover 全站唯一。
- 修掉 4 项 P0 可访问性问题与反馈/文案缺陷。
- 以 token 承载布局尺寸与动效时长，使布局规则可被后续视图复用。
- 沉淀 `docs/design/ui/layout-v1.md`，让呈现层重新进入验收范围。

**Non-Goals:**

- 不做 Providers/Settings 归并（已由 `14a3f7e` 完成）、不回滚、不外移任何设置面板。
- 不做字号 type scale 收敛（九档字号仅登记）、不做暗色主题、不做移动端抽屉导航。
- 不把 Providers 表单 inline 化（编辑仍走 Modal）、不删除设置视图。
- 不引入组件库、不改构建链。

## Decisions

1. **布局载体：`shell-main` 卡片内单一 grid，topbar 横跨列表与内容两列。**
   逐视图自定义（现状）导致三套 master-detail；备选「每视图自带头部」会破坏 topbar 唯一性，备选「整体改 CSS Grid 框架库」超 Non-Goals。列宽由 `--pane-list-w`（320px / 断点 220px）唯一定义，视图只引用不硬编码（现存 `ChatView.css` 断点 220px 硬编码须删除，否则变量失效）。

2. **设置视图层 2 采用双段结构：子菜单段 + 连接 item 段同栏共存（320px）。**
   备选 A「保留 168px 子菜单 + 内容区左右分栏」会形成 主菜单+子菜单+连接列表+内容 的四列嵌套（评审 P1 风险），且列表与内容职责被打散；备选 B「设置豁免三段式」与使用者原始裁决"列表（子菜单/item）"冲突。双段结构使"子菜单与 item 同属层 2"成为唯一形态，其他视图仅含 item 段。此决策取代 design-plans/001 v2 §1 的 Settings 168px 豁免条款（该豁免写于归并落地前）。

3. **选中态以 Chat 会话行现码为唯一 exemplar，规格逐字提取为 `.pane-item` + `is-current`。**
   不新造视觉值（评审 P0：v1 曾发明 `--surface`/`radius-sm`/`is-active` 新值，与现码不符）。迁移期对仍有私有行类的视图用双类限定（沿用 `.view.tasks-view` 的既有对抗方式），迁移完成后删除视图侧行类，终态不允许新旧行类并存。CSS Layer 重构可根治注入顺序问题，但波及全站，登记为后续候选。

4. **选中状态全部走查询参数，路由五处一体接线。**
   `WorkspaceRoute` 与 `WorkspaceLink` 同步扩展（`workspaceHref` 吃 Link 而非 Route，v1 曾漏）、`parseRoute` 读取、`App.tsx` switch 传参并补 `useMemo` 依赖。默认模型面板用独立参数 `panel=model` 而非 `connection=default` 字面量——`WorkspaceProviderView.id` 是自由 string，字面量会与真实 id 相撞（备选「保留 default 哨兵」需先验证服务端不产生该 id，收益不值一次撞车）。

5. **topbar 动作用 Context 插槽注册。**
   视图把主按钮注册进 Shell，卸载时移除。备选「Shell 按 view 硬编码按钮」把视图知识塞进壳层，新增视图动作要改两处；备选「按钮留列表栏头」违反列表栏头只放筛选搜索的职责契约。

6. **对比度用 `--faint-text` 拆分而非压深 `--faint`。**
   `--faint` 兼作文字与 hover 边框（`global.css`、`ChatView.css`）；整体压深会连带改变边框观感。拆分后文字切 `--faint-text: #676e5f`（对 surface ≈5.3:1、对 sunken ≈4.5:1），边框保留原值（3.2:1 ≥ UI 组件 3:1）。`--amber` → `#7a5d16`（对 amber-wash ≈5.3:1）。

7. **Modal 焦点：effect 清理归还焦点 + `onClose` 经 ref 读取 + 调用方传 dirty。**
   现状 effect 依赖 `[onClose]`，父组件每次 render 传新函数会重跑；StrictMode 双执行下若清理不归还会丢焦点。脏检查放调用方（表单初始值只有调用方知道），Modal 只提供机制。

8. **通知栈视觉合一、语义分离。**
   单栈右下排布解决"顶栈遮挡 topbar"；错误仍为独立 `role="alert"` 节点、常驻、不参与 4 条上限（上限只截最旧的成功/信息），满足 `ui-v1.md` §3.3 两级反馈语义。备选「保持双栈只挪位置」仍会在错误多条时侵入 topbar 区域。

9. **迁移顺序 Tasks → Packages → Schedules → 设置connections → Chat 微调。**
   Tasks 改动最小（去单列分支 + 空态），先行验证 token 与 `.pane-item` 链路；Packages 需抬升提前 return 的公共节点，风险中等；Schedules 涉及新路由参数与请求竞态，放后；Chat 只微调（SSE `key` 与清理函数是禁区）。Phase 0（a11y）无布局依赖，可独立先行交付。

## Risks / Trade-offs

- [行号随并发改动漂移（v1 教训）] → tasks 一律以类名/符号定位并附行号作参考；执行前强制核对 HEAD，不符即停（写入 tasks 的停止条件）。
- [Schedules 选中迁 URL 后旧请求写入新 id] → 详情子树随 `scheduleId` 卸载，或 effect 以 id 为依赖并保留 AbortController；验收加"快速连续切换 3 个 schedule"场景。
- [Chat SSE 泄漏/重连] → 重组 ChatView 列表结构时禁止触碰 `ConversationView` 的 `key={session}` 与清理函数；验收含断线重连冒烟。
- [双段列表栏让设置页信息密度变高] → item 段仅在 `connections` tab 出现；分组视觉（标题 vs 分隔线）属可延后决策，不改行为契约。
- [en/zh 字典不同构导致 typecheck 失败] → 每个新 key 成对提交，以 `corepack pnpm --filter @sage/agent-web typecheck` 为每 Phase 门禁。
- [reduced-motion 处理倒退] → 保留 `global.css` 现有全局限制块，只叠加 token 化时长，不改写为按动画逐个豁免（评审 P1#19：spinner 维持停止，文字提示兜底感知）。

## Migration Plan

1. **Phase 0（P0 可访问性，独立先行）**：token 拆分与 4 处文字切换、会话行嵌套拆解、Modal 焦点、aria 本地化。可单独合并，失败可单独回滚。
2. **Phase 1**：引入布局 token 与 `.pane-item`、topbar 插槽、SearchBox 可选提交、删除 220px 硬编码。
3. **Phase 2**：按 Decisions-9 顺序逐视图迁移，每视图一个独立 commit；设置双段结构随 `connections` 迁移一并落地。
4. **Phase 3**：通知栈、文案成对、Badge 降噪、表格滚动容器、动效 token、header 底色统一。
5. **Phase 4**：`layout-v1.md` 落档 + `ui-v1.md` §3.1 登记 + README 对冲遗留表述。

回滚：各 Phase/各视图 commit 独立，回滚单个 commit 不影响功能语义（无 API 变更）；`schedule=`/`connection=`/`panel=` 为新增参数，回滚路由扩展后旧链接回落默认视图，无破坏性。

## Open Questions

- 设置列表栏双段的分组视觉（子菜单段用分组标题还是分隔线、item 段的起始间距）——实现时取值即可，不改变行为契约、方案与任务拆分。
- 字号九档收敛为 type scale 的时机——已列 Non-Goal，另行立项。
