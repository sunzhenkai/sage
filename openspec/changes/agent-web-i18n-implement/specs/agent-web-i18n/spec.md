# Spec Delta

## Purpose

定义 agent-web 控制台的多语言（中文 / 英文）行为：自动检测与默认英文、手动切换与持久化、全量界面文案词典化、本地化格式化，以及会话搜索的 locale 传递与服务端回退默认。

## ADDED Requirements

### Requirement: 语言检测与默认
控制台 SHALL 按浏览器语言（navigator.languages 顺序）自动选择界面语言：任一 zh*（zh、zh-CN、zh-TW、zh-HK 等）→ 简体中文（zh-CN）；en* 或其他任意值（含无匹配、不可读取）→ 英文（en，默认）；`?lang=<locale>` 查询参数 SHALL 临时覆盖检测结果（按同规则归一化，不写入持久设置）。

#### Scenario: 中文变体
- **WHEN** 浏览器语言为 zh-TW 或 zh-HK
- **THEN** 界面显示简体中文

#### Scenario: 无匹配默认英文
- **WHEN** 浏览器语言为 de-DE、无法读取、或不在支持集合内
- **THEN** 界面显示英文

#### Scenario: URL 覆盖
- **WHEN** URL 携带 ?lang=zh-CN（已有持久偏好为英文）
- **THEN** 本次会话显示中文，且持久偏好保持不变

### Requirement: 手动切换与持久化
设置页 SHALL 提供语言选择（Auto / English / 中文）；手动选择 SHALL 持久化（localStorage `sage.agent-web.settings`，与主题等同一存储）并在后续加载优先于自动检测；Auto SHALL 每次加载重读浏览器语言；切换 SHALL 即时生效（无需刷新），并同步 `document.documentElement.lang`。

#### Scenario: 持久化
- **WHEN** 用户手动选择「中文」后刷新（浏览器语言为 en-US）
- **THEN** 界面仍为中文

#### Scenario: Auto 恢复
- **WHEN** 用户把语言改回「Auto」
- **THEN** 界面按浏览器语言重新计算

#### Scenario: 即时生效
- **WHEN** 用户切换语言
- **THEN** 当前页面文案立即切换且 `html` 元素 `lang` 属性同步

### Requirement: 界面文案词典化
控制台全部用户可见文案（导航、页头、按钮、表单占位、空态、错误提示、tooltip、aria-label）SHALL 来自 en / zh-CN 词典；英文为源；两词典键位 SHALL 一致并由自动测试校验；中文用词 SHALL 遵循任务术语表（如 Session=会话、Schedules=定时任务、Providers=供应商）。

#### Scenario: 中文界面无英文残留
- **WHEN** 任一主路由以中文界面渲染
- **THEN** 除用户数据与服务端返回内容外，不出现英文界面文案

#### Scenario: 键位漂移被测试拦截
- **WHEN** 两词典键集合不一致
- **THEN** 键位对齐测试失败

### Requirement: 本地化格式化
时间与相对时间显示（含图表日期轴）SHALL 随当前语言格式化：日期部分使用当前 locale，相对时间单位词（ago / 刚刚 等）来自词典。

#### Scenario: 相对时间随语言
- **WHEN** 界面语言在 en 与 zh-CN 间切换
- **THEN** 相对时间文本（含单位词）随语言变化

### Requirement: 会话搜索 locale 传递与服务端默认
agent-web 会话列表查询 SHALL 携带当前界面 locale；chat-domain 未命名会话搜索回退 SHALL 支持 en 与 zh-CN，且未提供 / 无法识别 locale 时默认 en；中文界面中未命名会话的显示文案 SHALL 与服务端中文回退词一致（未命名对话）。

#### Scenario: 中文搜索命中
- **WHEN** 中文界面搜索「未命名」（存在未命名会话）
- **THEN** 未命名会话被匹配

#### Scenario: 默认英文回退
- **WHEN** 请求未携带 locale（或无法识别）
- **THEN** 服务端按 en 回退词（Untitled Chat）匹配
