## Context

- agent-web 是 React 19 + Vite 的轻量前端（约 4k 行，单文件 `styles.css`），覆盖四个视图（Chat/Tasks/Packages/Providers）与 WorkspaceShell。默认 locale 为 zh-CN，全部文案经统一翻译资源。
- 现状视觉：浅蓝灰底 + 蓝主色（`#3867e8`）+ 深蓝侧栏（`#101828`）+ Inter——即「任意后台模板」观感；`index.html` 另有一套硬编码首帧骨架配色需与主题同步，否则挂载前后会闪变。
- 约 30 个 vitest 文件以类名、aria 属性、testid 与文案为断言锚点；`responsive-a11y.test.tsx` 还对 `styles.css` 做字面断言（`.task-row .status-badge { display: inline-flex; }` 必须存在、`:focus-visible`/`prefers-reduced-motion: reduce`/`overflow-x: hidden` 必须存在）。侧栏折叠测试断言根容器 className 精确等于 `'sidebar'` / `'sidebar is-collapsed'`。
- 既有行为规格（workspace-shell、chat-user-interface、workspace-status-presentation 等）约束了 DOM 结构与文案位置：账户区在侧栏左下角、无面包屑、无本地开发模式徽标、Chat 页头四要素等——重构必须原样保留。
- 参照系：用户提供 multica 界面截图作为美观易用性基准——浅灰画布 + 白色圆角内容案面、浅色侧栏灰色药丸选中态、近黑主按钮、发丝分割线、小字号中等对比度、克制的阴影与留白。

## Goals / Non-Goals

**Goals:**
- 视觉达到现代效率工具的整洁与密度：信息优先、装饰克制、层次靠留白与字重。
- 视觉与产品身份一致：思极/Sage、zh-CN 默认、事件账本心智。
- 样式决策令牌化、可规格化验收；一次重构后可长期演进。
- 全部既有测试不修改断言即通过。

**Non-Goals:**
- 不改任何交互行为、路由、数据流与 API 形态。
- 不引入外部字体、图标库或 CSS 框架（本地离线优先）。
- 不做暗色模式切换（浅色主题本身即是决策，双主题另行立项）。
- 不动 `?view=` 布局骨架（侧栏位置、账户区位置由 workspace-shell 规格锁定）。

## Decisions

### D1: 主题「素笺」——画布 + 案面的浅色双层结构
参照 multica 的空间层次并保留 Sage 的文房底色：应用画布取素笺灰（`#f6f6f4`，带极轻暖度的中性灰，侧栏直接坐在画布上），主内容区是一张白「案面」（`#ffffff`），以发丝边框（`#e6e8e3`）与左上 14px 圆角从画布上「浮起」，形成侧栏/内容的双层纵深而不需要任何重阴影。主操作色取近黑墨色（`#262b28`，带绿底的墨），呼应参考界面的黑色主按钮并延续「墨」的文房意象；品牌绿（松青 `#1e7a46`）退出按钮位，专职成功态与品牌点缀。状态色全部降饱和为软底徽章：琥珀 `#92600a`、朱砂 `#b3493a`、黛青 `#4a6785`、中性 `#5c645d`。显式规避三种 AI 默认风格：暖米+赤陶+衬线大标题、近黑+酸绿、报纸细线风——本主题的识别度来自「画布+案面」结构与墨色主按钮，而非装饰。

完整令牌见 styles.css `:root`（paper/surface/ink/muted/faint/line/pine/pine-deep/pine-soft/sealred/sealred-soft/amber/amber-soft/indigo/indigo-soft/primary/shell 系列，令牌名沿用既有命名便于审阅 diff）。文字对比度下限：正文与辅助文字 ≥ 4.5:1，大号标题 ≥ 3:1；更浅的灰只允许出现在边框、分割线、禁用态与纯装饰节点上。

### D2: 字体角色三分——衬线只留给印章
- **Display**：CJK 宋体系栈 `"Noto Serif SC","Source Han Serif SC","Source Han Serif CN",STSong,"Songti SC",SimSun,Georgia,serif`——仅用于品牌印章的「思」字形一处。页面 h1 回归系统黑体（21px/700/正字距），层级靠字重、字号与留白表达，与参考界面的效率工具气质一致。
- **Body/UI**：系统黑体栈 `"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei",-apple-system,"Segoe UI",system-ui,sans-serif`，正文 13px 基准、辅助 11–12px。
- **Data**：`ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`——session id、`#sequence`、digest、payload 预览、detail-card dd 一律等宽；账本的「数据处」与「叙述处」由此在字体层即可分辨。

不加载任何网络字体：本地开发模式常离线，FOUT 与字体请求失败不可接受。

### D3: 签名元素——墨印印章，把大胆只花在这一处
- **品牌印章**：brand-mark 为墨色圆角方块内的宋体白文「思」字（zh 品牌「思极」的首字，en 下作为字标符号存在，外层 `<a>` 已有双语 aria-label，装饰字形无需翻译），与墨色主按钮同色相呼应。favicon 同步为墨底「思」印。
- **刻度节点语言统一**：任务详情时间线与应用 Release 历史的 marker 统一为同一菱形节点（纯装饰 span）。对话区不设左侧脊线、挂载节点或序号刻度——轮次仅以双侧气泡布局呈现；事件序号仍以等宽 `#N` 形式保留在事件流调试面板中。
- **案面结构**：`.main-column` 白底 + 左/上发丝边 + 左上圆角 + 10px 画布露边，≤700px 断点退化为平面拼接。
- 其余部分保持安静：不做入场动画、不加装饰性纹理；动效仅保留待答圆点脉冲与 hover 过渡，全部受 `prefers-reduced-motion` 约束。

装饰节点均为 aria-hidden 或纯 CSS 几何，语义结构零变化。

### D4: CSS 重写策略——类名清单锁死 + 测试字面断言原样保留
以 inventory（196 个类名，来自非测试 TSX 的静态枚举 + 动态插值枚举）为检查清单重写 `styles.css`：每个类要么有新规则要么显式确认废弃。废弃记录（重构前存在、重构后已无任何 TSX 消费方的死选择器，一并移除）：`.provider-layout`、`.connection-check-button*`、`.event/.event-meta/.event-kind/.event-tool/.event-artifact/.event-error/.event-task/.event-run`、`.tool-line/.run-line`、`.info-callout`、`.toggle-field`、`.provider-mark-anthropic/.provider-mark-openai-compatible`、`.catalog-state`、`.provider-chip`、`.chat-overview*`、`.inline-notice-success/.inline-notice-error`（由 `.inline-notice.-error` 取代，与 TSX 实际写法一致）。以下字面内容逐字符保留以满足测试：`.task-row .status-badge { display: inline-flex; }`、不得出现 `.task-row .status-badge, .task-row-target { display: none; }`、`:focus-visible`、`prefers-reduced-motion: reduce`、`overflow-x: hidden`。侧栏根元素 className 保持精确 `'sidebar'` / `'sidebar is-collapsed'` 二值，主题不新增修饰类。

### D5: TSX 加法改动清单（全量）
1. `main.tsx` brand-mark 内容 `'S'`→`'思'`（无任何测试或 spec 引用该字形文本）。
2. `index.html`：theme-color、favicon、首帧骨架的配色与几何替换为新主题值（骨架 main 同步案面边框/圆角/露边，消除挂载前后闪变）。
除此之外零改动；若实施中发现需要第三处改动，先回设计文档补记录再动手。

## Risks / Trade-offs

- [浅色主题下徽章/辅助文字对比度容易被做浅 → 令牌级约束：辅助文字色实测算 ≥4.5:1，软底徽章文字用深色系文字而非中灰；更浅灰仅用于边框与装饰]。
- [墨色主按钮与危险色按钮并置时的层级混淆 → 危险操作保持「白底红字红边」的描边形态，与实心墨色主按钮在面积与明度上分离]。
- [390px 无横向溢出回归风险 → 保留既有 700px 断点规则全集并手工验证 390×844；任务行三要素可见性由 responsive-a11y 测试守卫]。
- [案面浮起结构在窄屏占宽度 → ≤700px 断点移除露边/圆角/边框，恢复平面拼接，内容宽度无损]。

## Migration Plan

单应用内纯呈现变更，随构建原子发布；无数据、契约、API 变化，回滚即回退构建。首帧骨架与主题同 commit 更新避免闪变窗口。
