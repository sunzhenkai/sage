# Proposal: agent-web-multica-style-alignment

## Why

agent-web 当前界面与目标参照（multica 工作台式布局）存在系统性差距：页面头普遍携带 eyebrow 讲解词与整句“说明书”副标题（如「浏览已登记的 ai app 应用，检查 manifest 与资产，并从不可变 Release 发起运行」「观察持久工作，检查不可变目标，并安全控制执行」「运维中心」），对话列表独占整页、主操作分散在各页，信息密度低、布局层级不合理。全量普查 `locale.tsx` 发现约 70 条文案命中五类“说明书句”模式（页面定位句、机制解释句、状态解释句、后果预告句、结果播报句），而 locale 测试只断言 key 非空，无任何密度门禁，导致此类文案持续混入。

## What Changes

- **壳层三栏化**：`main-column` 内引入 `content-split`（左 280px 常驻列表面板 + 右内容区），对话页首先落地（会话列表常驻第二栏、右侧为选中会话或空态）；视口 ≤700px 列表栏折叠为抽屉。
- **页头单行化**：四个视图页头压缩为「名词标题 + 右侧动作」单行，删除全部 eyebrow 层与页面副标题；被删除 eyebrow 承担的可访问名迁入 `aria-label`（删文字不删标签）。
- **任务页对齐看板顶栏**：状态筛选由下拉改为 filter chips（全部/运行中/已暂停/失败/已成功/已取消）；任务详情页删除说明书段落，头部只留返回链接、任务 ID、状态徽章与刷新。
- **应用页创建/导入弹窗化**：内联展开表单与示例导入卡改为居中 modal（面包屑式标题 + 极简字段）；发起运行 hint 长段压缩为一行。
- **服务商页设置形态**：改为「左子导航（运行 Agent / 工作区 Providers / 模型目录）+ 右内容卡」，三段安全说教长句压为字段级一行 hint。
- **话语层文案批量治理**：按 P1–P5 模式删除约 40 条、压缩改写约 30 条 locale 文案；12 条豁免（安全语义、可操作错误、字段 hint、placeholder）显式登记。
- **红线规则与门禁**：设计语言 spec 新增「界面话语层红线」Requirement；`locale.test.tsx` 新增话语密度断言（非豁免 key 中文 ≤24 字 / 英文 ≤10 词），豁免白名单登记在测试内。
- **BREAKING（呈现层）**：删除 eyebrow/副标题相关可见文案与部分类名引用，突破 `web-interface-design-language` 既有「呈现层零行为变更」条款中“类名钩子保持不变”的约定，突破范围白名单在 design.md 显式登记。路由、URL 语义、数据契约、控制操作、`data-testid` 均不变。

## Capabilities

### New Capabilities

（无新增 capability。）

### Modified Capabilities

- `web-interface-design-language`: 新增「界面话语层红线」Requirement（页头零描述句、说明文字三处原则、机制术语禁入、toast 完成式短句、确认框只述后果）；修订「呈现层零行为变更与质量底线」，为本次 eyebrow/副标题删除开放显式白名单。
- `web-interface-localization`: 新增「文案密度与话语类型」Requirement（zh/en 长度上限、双语密度对等、豁免白名单机制）。
- `workspace-shell`: 侧栏删除品牌副标题与运行时脚注、新增全局搜索位与主操作按钮入口的形态约定；`main-column` 支持三栏内容分栏；窄视口下列表栏抽屉化。
- `workspace-status-presentation`: 修订「Workspace Header Information Placement」与「Chat 页面头部上下文信息」——页头信息压缩为单行（标题 + 动作 + 状态点），Chat 头部信息栏收窄（连接状态点 + 运行时标识保留，任务提升入口改为短词按钮）。
- `chat-user-interface`: 对话落地页由整页历史列表改为常驻第二栏列表 + 右侧空态/会话；空态文案收敛为单句。
- `task-operations-interface`: 任务列表页头单行化与 filter chips 形态、任务详情页说明书段落移除（控制授权说明迁入控件 `title`）。
- `package-management-interface`: 「应用包管理界面」Requirement 中新建/导入表单形态由内联卡片改为模态弹窗。

## Impact

- **代码**：`platform/apps/agent-web/src/` 下 `main.tsx`（壳层三栏、侧栏精简）、`workspace.tsx`（对话列表栏化）、`chat.tsx`（头部收窄、空态收敛）、`tasks.tsx`（页头/chips/详情）、`packages.tsx`（弹窗化）、`providers.tsx`（设置形态）、`schedules.tsx`（页头）、`locale.tsx`（约 70 条文案删改）、`styles.css`（content-split、chips、modal、密度 token）。
- **测试**：`locale.test.tsx`（门禁断言）、`header-alignment.test.tsx`（页头断言改写）、`responsive-a11y.test.tsx`（styles.css 字面断言同步、390px 抽屉断言）、`sidebar-collapse.test.tsx`、`workspace.test.tsx`、`tasks*.test.tsx`、`packages.test.tsx`、`schedules.test.tsx` 适配。
- **Spec**：上述 7 个 capability 的 delta；归档时回写主 spec。
- **不影响**：全部 HTTP API、Temporal/Postgres 运行时、CLI、数据模型；路由与 URL 查询参数语义不变。
