# package-management-interface 变更增量

## MODIFIED Requirements

### Requirement: 从包发起运行并追踪

详情页 SHALL 提供发起运行表单：表单字段 SHALL 由该 App 归一化 manifest 的 `inputs` 声明渲染（文本/枚举控件 + 声明默认值），多任务 App SHALL 提供任务选择；界面 SHALL NOT 提供自由文本输入框或空输入警告/二次确认（输入闭环由声明与默认值保证）。提交时 SHALL 以 `{task, params}` 调用运行入口；提交成功后 SHALL 跳转到该运行的 task 视图并持续展示状态直至终态。终态后 SHALL 可查看产物：succeeded 且已登记输出 package 时，界面 SHALL 提供 `tar.gz` 下载、列出包内文件，并对文本文件（如 markdown / plain text / json）提供内联预览（含残留 think 段则折叠展示）；非文本文件 SHALL 仅提供下载，SHALL NOT 当作单段 task-output 正文强制渲染。`failed` 终态 SHALL 展示稳定错误码与失败明细，且重试控制可用。

#### Scenario: 发起运行
- **WHEN** 用户在声明参数表单（预填默认值）提交发起运行
- **THEN** 界面以 {task, params} 创建运行并导航到运行详情，展示运行中状态

#### Scenario: 参数校验错误内联展示
- **WHEN** 提交的参数未通过声明校验（API 返回 `PACKAGE_PARAMS_INVALID`）
- **THEN** 界面内联展示违规项，不跳转

#### Scenario: 追踪至终态与查看输出 package
- **WHEN** 运行达到 succeeded 终态且已登记输出 package
- **THEN** 界面展示终态，提供 `tar.gz` 下载与包内文件清单；文本文件可内联预览，非文本文件仅可下载

#### Scenario: 失败终态展示明细且可重试
- **WHEN** 运行达到 failed 终态且投影含错误码与明细
- **THEN** 界面展示该错误码与明细，重试控制可用，不把控制锁死为 effect_unknown

### Requirement: 应用包管理界面

web 界面 SHALL 在包管理域提供应用（App）的主体管理：列表页页面头 SHALL 为单行（名词标题 + 右侧「新建应用」「导入示例」动作）；「新建 App」与「导入示例」SHALL 以居中模态弹窗承载，弹窗以面包屑式标题（如「应用 › 新建应用」）标识上下文，字段保持极简（appId、name、description，含必填与格式校验）；详情页 SHALL 提供「上传/更新版本」表单（经文件选择器上传单个源包压缩包文件登记为新版本）与「删除 App」操作（二次确认并只陈述不可逆后果一行）；界面 SHALL 展示版本历史（倒序）并在上传/删除后刷新。空态、加载态与错误态 SHALL 有明确展示，新建/删除/上传操作 SHALL 提供双语文案与 aria 语义。空态引导 SHALL 为单行短句加动作按钮，SHALL NOT 以整段文字解释登记方式与系统行为。

#### Scenario: 新建 App
- **WHEN** 用户在列表页通过「新建应用」弹窗填写 appId、name、description 并提交新建
- **THEN** 界面创建 App，成功后列表出现该 App 或跳转其详情

#### Scenario: 新建表单校验
- **WHEN** 用户提交缺失必填项或非法 appId 的新建表单
- **THEN** 界面阻止提交并在弹窗内展示内联校验错误

#### Scenario: 导入示例弹窗
- **WHEN** 用户在列表页点击「导入示例」
- **THEN** 打开模态弹窗展示示例清单与逐项导入动作；导入机制说明只以一行短句呈现

#### Scenario: 上传新版本
- **WHEN** 用户在详情页经文件选择器选择单个源包压缩包（tar / tar.gz / tgz / gzip 单文件 / zip）并提交
- **THEN** 界面以 multipart 上传该压缩包并登记新版本，版本历史新增该版本并自动刷新

#### Scenario: 不支持的文件被拦截
- **WHEN** 用户选择非压缩包文件（或超出大小上限的压缩包）并提交
- **THEN** 界面阻止提交并展示单行内联错误，说明支持的格式与上限

#### Scenario: 删除 App
- **WHEN** 用户在详情页触发删除并确认
- **THEN** 确认框只陈述不可逆后果一行；确认后界面删除该 App，之后列表不再显示该 App

#### Scenario: 版本历史展示
- **WHEN** 用户查看某 App 详情
- **THEN** 界面按版本倒序展示 release 历史（版本、digest、时间）

#### Scenario: 操作错误反馈
- **WHEN** 新建/上传/删除请求失败
- **THEN** 界面展示稳定错误提示且页面状态一致（不残留半成品）

#### Scenario: 空态引导
- **WHEN** 当前没有任何 App
- **THEN** 列表页展示空态单行短句并引导用户新建 App

#### Scenario: 列表页头单行
- **WHEN** 渲染应用列表页
- **THEN** 页头为一行（标题 + 动作），不出现 eyebrow 讲解词与整句副标题

## ADDED Requirements

### Requirement: 源包压缩包上传

`POST /v1/apps/:appId/releases` SHALL 支持 multipart/form-data 通道：接受单个压缩包文件（tar / tar.gz / tgz / gzip 单文件 / zip），服务端解包为源包目录后走既有目录约定编译与登记。解包 SHALL 安全受限：拒绝路径穿越（含 `..` 与绝对路径条目）、拒绝符号链接与非常规文件条目、限制条目数与解包总体积（单资产上限沿用既有文本资产约束）、拒绝包内可执行扩展名与疑似 Secret 内容（复用源包加载既有边界）。未命中压缩包格式、包损坏、解包受限拒绝或解包结果不满足源包契约（缺 `app.yaml`、含未声明资产）SHALL 以稳定 4xx 错误码拒绝并说明原因。既有 JSON `files` 通道 SHALL 保留，行为不变；两通道的幂等、版本与编译语义一致。

#### Scenario: 上传 tar.gz 登记新版本

- **WHEN** 客户端以 multipart 上传合法的 `app-v2.tar.gz`（含 app.yaml、prompts/、references/）
- **THEN** 服务端解包、编译并登记新 Release，响应与既有 JSON 通道字段一致（packageVersion、releaseRef、contentDigest 等）

#### Scenario: 支持的压缩包格式全覆盖

- **WHEN** 分别上传未压缩 tar、tar.gz、tgz、单文件 gzip、zip 格式的合法源包
- **THEN** 全部解包成功并登记对应版本，格式差异对编译与登记结果无影响

#### Scenario: 路径穿越条目拒绝

- **WHEN** 压缩包含 `../../escape.md` 或绝对路径条目
- **THEN** 以稳定 4xx 错误码拒绝整个上传，不落盘、不产生部分 Release

#### Scenario: 符号链接与可执行内容拒绝

- **WHEN** 压缩包含符号链接条目或可执行扩展名文件（如 .sh/.py）
- **THEN** 以稳定 4xx 错误码拒绝，错误信息指明违规条目

#### Scenario: 超限拒绝

- **WHEN** 压缩包条目数或解包总体积超过声明上限
- **THEN** 以稳定 4xx 错误码拒绝，说明上限值

#### Scenario: 损坏压缩包拒绝

- **WHEN** 上传的文件声称为 tar.gz 但数据损坏或不是压缩包
- **THEN** 以稳定 4xx 错误码拒绝，不产生部分登记

#### Scenario: 既有 JSON 通道兼容

- **WHEN** 客户端仍以 JSON `files` 记录调用同一端点
- **THEN** 行为与既有路径一致（逐字节等价），不要求迁移
