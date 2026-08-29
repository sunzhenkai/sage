## Purpose

agent-web 呈现层的设计语言规范：定义唯一主题「素笺」的设计令牌体系、画布+案面布局签名、字体角色分工、品牌印章与刻度节点签名元素、状态色语义映射，以及呈现层零行为变更的质量底线（焦点可见、reduced-motion 回退、窄视口无横向溢出）。

## Requirements

### Requirement: 设计令牌体系

Web SHALL 以 `:root` CSS 自定义属性定义唯一呈现层主题「素笺」的设计令牌，且 SHALL 覆盖至少以下语义角色：应用画布底色（素笺灰）、案面表面色（白）、正文墨色、辅助/弱化文字色、分隔线色、主操作色（近黑墨色）及其 hover 态、成功色（松青）、危险色（朱砂）、警示色（琥珀）、信息色（黛青）及各色的软底变体；侧栏骨架 SHALL 使用画布同族的壳层令牌组（含 hover 与选中态）。任意用户可见文字与其背景的实际对比度 SHALL 满足：正文与辅助文字 ≥ 4.5:1，大号标题 ≥ 3:1。视图样式 SHALL NOT 在令牌定义之外引入新的主题色值（等宽字体栈等非色彩常量、纯装饰几何的边框灰除外）。

#### Scenario: 令牌单一定义点
- **WHEN** 开发者为任一视图调整主题颜色
- **THEN** 仅需修改 `:root` 中对应令牌，不存在第二处硬编码主题色值需同步修改

#### Scenario: 对比度下限
- **WHEN** 任一正文级或辅助级文字以其声明的背景色渲染
- **THEN** 实际对比度不低于 4.5:1（大号标题不低于 3:1）

### Requirement: 画布与案面的布局签名

Web SHALL 采用「画布 + 案面」双层布局：侧栏 SHALL 直接呈现于画布底色上，导航项的 hover 与选中态 SHALL 为画布上的灰色圆角药丸形态；主内容区 SHALL 呈现为带发丝边框与左上圆角的白色案面，案面顶部 SHALL 露出画布窄边。视口 ≤700px 时该结构 SHALL 退化为平面拼接（无露边、无圆角、无侧向边框），顶部横向导航形态不变。

#### Scenario: 双层结构呈现
- **WHEN** 用户以桌面视口打开任一视图
- **THEN** 侧栏区域为灰画布、内容区域为带左上圆角的白案面，两层以发丝边框分界

#### Scenario: 窄屏平面退化
- **WHEN** 视口 ≤700px
- **THEN** 案面与画布间无露边与圆角，页面无横向溢出

### Requirement: 字体角色分工

Web SHALL 将字体划分为三个互斥角色并以令牌声明：Display 角色（CJK 宋体系衬线栈）SHALL 仅用于品牌印章的装饰字形一处；Body/UI 角色（系统黑体栈，含 PingFang SC/Noto Sans SC 等 CJK 优先回退）SHALL 用于全部页面标题、正文、控件与导航文案；Data 角色（系统等宽栈）SHALL 用于会话 id、事件序号、digest、payload 预览与任务详情键值。Web SHALL NOT 加载任何外部网络字体资源。

#### Scenario: 标题使用 body 角色
- **WHEN** 用户打开任一视图
- **THEN** 页面 h1 与全部界面文字以黑体栈渲染，仅品牌印章字形为宋体系

#### Scenario: 数据以等宽呈现
- **WHEN** 界面展示 session id、`#序号` 或 digest 类数据
- **THEN** 该片段以等宽字体渲染，与叙述性文字在字体层可区分

#### Scenario: 离线无外部字体请求
- **WHEN** 页面在断网环境下加载
- **THEN** 不发起任何字体网络请求，界面以上述系统栈完整呈现

### Requirement: 品牌印章签名元素

Web SHALL 以印章式方字块作为品牌标识：WorkspaceShell 的 brand-mark SHALL 渲染为近黑墨色圆角方块内含宋体「思」字形，且该字形 SHALL 为纯装饰性内容（外层链接保留既有双语可访问名称）。站点 favicon 与 `theme-color` SHALL 与该印章语言及画布底色一致。

#### Scenario: 品牌块呈现与可访问性
- **WHEN** 用户访问任一视图并聚焦侧栏品牌链接
- **THEN** 视觉上呈现印章式「思」字块，读屏器播报的仍是既有的双语 aria-label 而非装饰字形

### Requirement: 刻度节点视觉语言

任务详情执行时间线与应用 Release 历史的节点 SHALL 复用同一菱形刻度视觉语言（纯装饰性标记节点）；对话时间线 SHALL 仅以气泡布局呈现，SHALL NOT 渲染左侧脊线、轮次挂载节点或起始事件序号标注。上述装饰 SHALL NOT 改变相关视图的语义结构或既有类名钩子。

#### Scenario: 同一节点语言跨视图复用
- **WHEN** 用户分别查看任务详情执行时间线与应用详情的 Release 历史
- **THEN** 两处的刻度节点以同一菱形形态呈现

#### Scenario: 对话区无脊线装饰
- **WHEN** 用户打开任一会话的对话页
- **THEN** 消息流左侧不存在纵向脊线、菱形挂载节点或 `#N` 序号刻度，气泡布局占满内容宽度

### Requirement: 状态色语义映射

Web SHALL 固定状态到颜色的映射并经徽章/状态类呈现：running 与 paused 及投影 stale 映射琥珀系；failed 与危险操作及 effect_unknown 映射朱砂系；succeeded 映射松青成功系；cancelled 与 info 类提示映射黛青系；其余中性状态映射灰绿中性系。该映射 SHALL 对 Chat 历史、任务列表、任务详情与 Provider 可用性徽章一致生效。

#### Scenario: 同一状态跨视图同色
- **WHEN** 用户分别在对话历史行与任务列表中查看 running 状态
- **THEN** 两处以同一琥珀系徽章呈现，不因视图不同而换色

### Requirement: 呈现层零行为变更与质量底线

本能力约束的重构 SHALL NOT 改变任何运行时行为：路由与 URL 语义、composer 键位与 IME 行为、会话读写门控、自动滚动、运行时选择器持久化、导出链路、全部既有 `data-testid`、`aria-*` 属性、类名钩子与翻译资源调用 SHALL 保持不变；TSX 变更 SHALL 限于 design.md 记录的加法清单。Web SHALL 维持质量底线规则：可见键盘焦点样式（`:focus-visible`）、`prefers-reduced-motion: reduce` 回退、页面级 `overflow-x: hidden`、390×844 视口下任务行三要素（Task ID、执行状态、投影新鲜度）可见且无横向溢出、视口 ≤700px 时顶部横向导航形态不变。

#### Scenario: 既有测试无需改断言即通过
- **WHEN** 重构完成后运行 agent-web 全量 vitest 用例与 typecheck/build
- **THEN** 全部通过，且 responsive-a11y 对 styles.css 的字面断言原样成立

#### Scenario: 窄视口质量底线
- **WHEN** 用户以 390×844 视口打开任务列表或以 ≤700px 视口打开任一视图
- **THEN** 任务行的 Task ID、执行状态与投影新鲜度均可见，页面无横向溢出，shell 保持顶部横向导航形态
