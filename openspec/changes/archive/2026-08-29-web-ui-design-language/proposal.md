## Why

agent-web 现有视觉层是一套未成文的通用 SaaS 蓝（Inter + 蓝主色 + 深蓝侧栏），与产品身份不符：思极/Sage 是 zh-CN 默认、事件账本化（sequence 化 timeline、JSONL 导出、receipt/checkpoint 契约）的本地 agent 工作台，界面却长得像任何一个后台模板。样式决策散落在单文件 CSS 中，无令牌约束、无规格可审。需要一次纯呈现层重构，把「这个产品应该长什么样」沉淀为可验收的 OpenSpec 规格，并落地实现。

## What Changes

- **建立唯一呈现层主题「素笺」**：以 multica 类现代效率工具为参照的浅色工作台语言——浅灰画布承载浅色侧栏，主内容区为一张带发丝边框与大圆角的白色「案面」；主操作色取近黑墨色；成功/警示/危险/信息以低饱和软底徽章呈现；全部颜色经 `:root` 设计令牌定义并约束对比度下限。
- **字体角色三分**：品牌印章「思」字用 CJK 宋体系字形（唯一的衬线出现点）；页面标题、正文与控件一律系统黑体栈（PingFang SC / Noto Sans SC 等），标题层级靠字重与字号而非衬线表达；会话 id、序号、digest、payload 等数据一律等宽字体。
- **签名元素**：品牌印章——侧栏 brand-mark 以墨色「思」字块呈现；任务详情时间线与 Release 历史复用同一菱形刻度节点语言。对话轮次仅以双侧气泡布局呈现，不设左侧时间线脊线或序号刻度。
- **布局签名**：侧栏与内容「画布 + 案面」双层结构——侧栏直接坐在画布上（hover/active 用灰色圆角药丸态），内容区是一张左上圆角白案，呼应参考界面的空间层次；工具栏统一为「搜索居左、筛选/视图控件居右」的密度。
- **状态色语义映射固定**：running/paused/stale→琥珀，failed/danger→朱砂，succeeded→松青，cancelled/info→黛青，neutral→中性灰绿。
- **零行为变更承诺**：路由语义、composer 键位、会话读写门控、运行时选择器、滚动跟随、导出链路、全部 `data-testid`/`aria-*`/类名钩子与 `t()` 文案资源保持不变；TSX 仅一处加法改动（brand-mark 字形文本）。

## Capabilities

### New Capabilities

- `web-interface-design-language`: agent-web 呈现层的设计令牌体系、字体角色分工、签名元素与质量底线（焦点可见、reduced-motion 回退、390px 无横向溢出）。

### Modified Capabilities

（无——所有既有行为规格不受影响，本次仅新增呈现层规格。）

## Impact

- **Web**：`platform/apps/agent-web/src/styles.css` 全量重写（沿用既有 196 个类名钩子清单，保留 responsive-a11y 测试断言的字面 CSS 规则）；`index.html` 首帧骨架配色与几何同步新主题避免闪变；`main.tsx` 一处加法微调（brand-mark 字形）。
- **其他包**：不受影响。不引入任何外部字体/图标依赖（本地离线环境，全部使用系统字体栈）。
- **验证**：agent-web vitest 全量测试、typecheck、vite build、390×844 手工检查、`openspec validate web-ui-design-language --strict`。
