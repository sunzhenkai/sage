## ADDED Requirements

### Requirement: 支持的 Web locale 具有唯一规范形态
系统 MUST 仅将 `zh-CN` 和 `en` 作为 Agent Web 内部支持的 locale，并 MUST 在环境输入边界将中文与英文的 BCP 47 语言标签规范化为对应 locale。

#### Scenario: 中文地区标签规范化
- **WHEN** locale 解析器收到 `zh` 或任意 `zh-*` 语言标签
- **THEN** 系统将其规范化为 `zh-CN`

#### Scenario: 英文地区标签规范化
- **WHEN** locale 解析器收到 `en` 或任意 `en-*` 语言标签
- **THEN** 系统将其规范化为 `en`

#### Scenario: 不支持的标签不扩展内部 locale
- **WHEN** locale 解析器收到既非中文也非英文的语言标签
- **THEN** 系统将该输入视为不受支持，并且不会把原始标签作为内部 locale

### Requirement: 初始化 locale 使用确定性优先级
系统 MUST 在启动时优先采用有效的持久化用户选择；仅当不存在有效选择时才 MUST 按浏览器首选语言顺序自动检测；检测不可用、失败、为空或没有受支持结果时 MUST 使用 `zh-CN`。

#### Scenario: 持久化用户选择优先于浏览器语言
- **WHEN** 存储中存在有效的 `en` 用户选择且浏览器首选语言为中文
- **THEN** 系统以 `en` 启动

#### Scenario: 无用户选择时采用首个受支持浏览器语言
- **WHEN** 不存在有效持久化选择且浏览器语言顺序为 `fr-FR`、`en-US`、`zh-CN`
- **THEN** 系统忽略不支持的 `fr-FR` 并以 `en` 启动

#### Scenario: 无效持久化值不阻断自动检测
- **WHEN** 存储值无法规范化且浏览器首选语言包含 `zh-Hans-CN`
- **THEN** 系统隔离无效存储值并以 `zh-CN` 启动

#### Scenario: 浏览器语言不受支持时默认中文
- **WHEN** 不存在有效用户选择且所有可读浏览器语言均不受支持
- **THEN** 系统以 `zh-CN` 启动

#### Scenario: 语言检测异常时默认中文
- **WHEN** 不存在有效用户选择且读取浏览器语言信息失败、抛错或返回空值
- **THEN** 系统保持可用并以 `zh-CN` 启动

### Requirement: 用户可以即时切换并持久化语言
系统 MUST 提供可访问的中文与英文切换入口。用户主动选择受支持 locale 后，系统 MUST 无需整页刷新即可更新当前界面，并 MUST 尽力将该选择写入同源持久化存储。

#### Scenario: 从中文即时切换到英文
- **WHEN** 当前 locale 为 `zh-CN` 且用户在语言控件中选择 English
- **THEN** 当前页面的产品文案立即以 `en` 重新呈现且现有业务上下文不丢失

#### Scenario: 刷新后恢复显式选择
- **WHEN** 用户选择 `en`、持久化写入成功并重新加载应用
- **THEN** 系统在浏览器检测之前恢复 `en`

#### Scenario: 持久化写入失败不撤销当前选择
- **WHEN** 用户切换 locale 但持久化存储不可写或抛错
- **THEN** 系统仍在当前运行期采用所选 locale，且不会进入应用错误状态

#### Scenario: 语言控件在两种界面中均可识别
- **WHEN** 用户在 `zh-CN` 或 `en` 界面访问公共 shell
- **THEN** 系统呈现具有可访问名称且选项可自我识别为“中文”和“English”的语言控件

### Requirement: 用户可见产品文案具有完整双语覆盖
系统 MUST 通过统一翻译资源呈现公共 shell、Workspace、Chat、Task、Provider 和 Profile 的产品文案，包括标题、导航、按钮、字段标签、placeholder、状态、loading/error/empty 文案以及 `aria-label` 和 `title` 等辅助文本。`zh-CN` 与 `en` 资源 MUST 具有相同且非空的 message key 集。

#### Scenario: 中文页面不混入未翻译英文产品文案
- **WHEN** 用户以 `zh-CN` 访问任一受支持页面及其 loading、empty、error 和交互状态
- **THEN** 页面产品文案使用中文资源，技术标识符、品牌名和原始业务数据除外

#### Scenario: 英文页面完整可用
- **WHEN** 用户以 `en` 访问任一受支持页面及其主要交互状态
- **THEN** 页面产品文案使用英文资源且功能与中文界面一致

#### Scenario: 翻译资源 key 保持完整一致
- **WHEN** 构建或测试检查 `zh-CN` 与 `en` 翻译资源
- **THEN** 两套资源包含完全相同的 message key 且每个值均非空

#### Scenario: 动态业务数据保持原值
- **WHEN** 本地化文案包裹用户输入、Provider/model 名称、Chat/Task 内容、artifact 或服务端返回数据
- **THEN** 系统仅翻译产品文案，不修改、翻译或重新编码原始业务数据

### Requirement: locale-sensitive 呈现跟随当前语言
系统 MUST 使用当前 locale 格式化由 Web 界面呈现的日期和时间，并 MUST 使文档语言属性反映当前 locale。

#### Scenario: 日期时间随 locale 切换
- **WHEN** 同一日期时间值分别在 `zh-CN` 和 `en` 界面呈现
- **THEN** 系统使用对应 locale 的格式化结果且底层时间值不变

#### Scenario: 文档语言在启动时同步
- **WHEN** 应用解析出初始 locale
- **THEN** `document.documentElement.lang` 设置为该规范 locale

#### Scenario: 文档语言在运行时同步
- **WHEN** 用户通过语言控件切换 locale
- **THEN** `document.documentElement.lang` 与界面文案在同一次状态更新中切换到所选 locale

### Requirement: 本地化不得改变业务行为
系统 MUST 将本地化限制在 Web 呈现层，不得因 locale 改变 API 请求、路由语义、领域枚举值、用户工作流或服务端持久化数据。

#### Scenario: 两种 locale 执行相同工作流
- **WHEN** 用户分别以 `zh-CN` 和 `en` 执行相同的 Chat、Task、Provider 或 Profile 操作
- **THEN** 系统发送等价的业务请求并得到等价的状态转换，差异仅限界面文案与 locale-sensitive 格式

#### Scenario: 切换语言保留当前业务上下文
- **WHEN** 用户在已有导航位置、表单状态或已加载数据的页面切换 locale
- **THEN** 系统保留当前业务上下文并仅重新呈现本地化内容
