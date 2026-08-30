## ADDED Requirements

### Requirement: 界面话语层红线

Web SHALL 将用户可见文案的话语类型限制为信息本身，SHALL NOT 在界面首屏向用户讲解页面用途或系统机制。页面头与面板头 SHALL 只含名词标题与动作控件，SHALL NOT 出现描述句、页面定位句或 eyebrow 讲解词。说明性文字 SHALL 只存在于三处：表单控件的 placeholder 或字段级 hint、空态单行（中文不超过 20 字 / 英文不超过 8 词）、tooltip 或等价 `title` 属性；SHALL NOT 以独立段落出现在页面头、列表头或状态徽章旁。用户可见首屏文案 SHALL NOT 出现实现机制术语（如持久化、投影、密封、幂等、不可变、裁决），除非该术语本身是用户直接操作的对象（如 Release 列表、运行日志视图中的 attempt）。操作结果播报（toast/notice）SHALL 为动词完成式短句，SHALL NOT 复述用户刚执行的操作细节或展望系统下一步。确认对话框 SHALL 只陈述不可逆后果一行，SHALL NOT 解释系统内部处理方式。

豁免 SHALL 仅覆盖三类文案并以显式清单登记：承载产品安全语义的状态说明（如效果未知防重复副作用）、含可操作下一步的错误文案（指明配置项或跳转目标）、表单字段约束 hint。新增豁免 SHALL 伴随测试白名单变更，即经过代码评审。

#### Scenario: 页面头零描述句
- **WHEN** 渲染任一工作区视图（对话/任务/应用/定时任务/服务商）
- **THEN** 页面头只含名词标题与动作控件，不出现副标题句或 eyebrow 讲解词

#### Scenario: 说明文字仅存在于三处
- **WHEN** 审查任一视图中的说明性文案
- **THEN** 其只出现在控件 placeholder/hint、空态单行或 tooltip 中，不以独立段落占据页面头、列表头或徽章旁

#### Scenario: 机制术语不进首屏
- **WHEN** 渲染页面头、列表行、状态徽章等首屏元素
- **THEN** 不出现「持久化」「投影」「密封」「幂等」「不可变」等实现机制术语；Release/attempt 等用户操作对象除外

#### Scenario: 结果播报为完成式短句
- **WHEN** 归档、复制、保存等操作完成并展示 toast/notice
- **THEN** 文案为动词完成式短句（如「已归档」），不复述操作细节、不展望系统后续动作

#### Scenario: 确认框只述后果
- **WHEN** 展示删除或破坏性操作的确认对话框
- **THEN** 正文只陈述不可逆后果一行，不解释系统内部处理方式（如审计保留、凭据清除机制）

#### Scenario: 豁免走白名单评审
- **WHEN** 新增一条超出密度上限的用户可见文案
- **THEN** 该 key 必须登记在密度门禁测试的豁免白名单中方可通过测试

## MODIFIED Requirements

### Requirement: 呈现层零行为变更与质量底线

本能力约束的重构 SHALL NOT 改变任何运行时行为：路由与 URL 语义、composer 键位与 IME 行为、会话读写门控、自动滚动、运行时选择器持久化、导出链路、全部既有 `data-testid` 与 `aria-*` 属性 SHALL 保持不变。类名钩子的默认约定仍为保持不变；仅当 change 的 design.md 以显式白名单登记（条款级列出删除的类名与对应理由）时，SHALL 允许删除该白名单内的可见装饰元素及其类名引用，且被删除元素承担的可访问名 SHALL 迁入 `aria-label` 或等价属性。Web SHALL 维持质量底线规则：可见键盘焦点样式（`:focus-visible`）、`prefers-reduced-motion: reduce` 回退、页面级 `overflow-x: hidden`、390×844 视口下任务行三要素（Task ID、执行状态、投影新鲜度）可见且无横向溢出、视口 ≤700px 时顶部横向导航形态不变；三栏内容分栏在该视口下 SHALL 退化为列表栏抽屉或整页切换，不得产生横向溢出。

#### Scenario: 既有测试无需改断言即通过
- **WHEN** 重构完成后运行 agent-web 全量 vitest 用例与 typecheck/build
- **THEN** 除 design.md 白名单条款对应的断言外，全部通过，且 responsive-a11y 对 styles.css 的字面断言原样成立

#### Scenario: 窄视口质量底线
- **WHEN** 用户以 390×844 视口打开任务列表或以 ≤700px 视口打开任一视图
- **THEN** 任务行的 Task ID、执行状态与投影新鲜度均可见，页面无横向溢出，shell 保持顶部横向导航形态

#### Scenario: 白名单突破可审计
- **WHEN** 任一 change 删除可见装饰元素及其类名引用
- **THEN** design.md 中存在逐条登记该删除的白名单，且受影响的可访问名已迁移并有无障碍断言覆盖
