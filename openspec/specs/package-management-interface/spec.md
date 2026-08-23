# package-management-interface Specification

## Purpose
为最终用户提供 ai app 包（AgentPackage/Release）的浏览、详情查看与发起运行的用户界面契约，衔接 agent-release-registry 与 agent-run-admission 的 HTTP 面。
## Requirements
### Requirement: 包列表与详情浏览
web 界面 SHALL 提供包列表页（id、最新版本、描述、最近 release 时间）与包详情页（manifest 摘要、prompts/references 资产内容预览、release 历史与 digest）；资产预览 SHALL 只读展示，不提供编辑。

#### Scenario: 浏览包列表
- **WHEN** 用户进入包列表页
- **THEN** 界面展示已登记包的摘要信息，空态有明确引导

#### Scenario: 查看包详情
- **WHEN** 用户打开某包详情
- **THEN** 展示 manifest 摘要、资产预览与 release 历史（含 digest）

### Requirement: 从包发起运行并追踪
详情页 SHALL 提供发起运行表单（必填用户输入文本）；提交成功后 SHALL 跳转到该运行的 task 视图并持续展示状态直至终态，终态后可查看 artifact。

#### Scenario: 发起运行
- **WHEN** 用户填写输入并提交发起运行
- **THEN** 界面创建运行并导航到运行详情，展示运行中状态

#### Scenario: 追踪至终态与查看产物
- **WHEN** 运行达到 succeeded/failed 等终态
- **THEN** 界面展示终态与失败原因（如有），succeeded 时可查看 artifact 内容

### Requirement: 应用包管理界面
web 界面 SHALL 在包管理域提供应用（App）的主体管理：列表页 SHALL 提供「新建 App」入口（填写 appId、name、description，含必填与格式校验）；详情页 SHALL 提供「上传/更新版本」表单（上传源包文件登记为新版本）与「删除 App」操作（二次确认并展示结果）；界面 SHALL 展示版本历史（倒序）并在上传/删除后刷新。空态、加载态与错误态 SHALL 有明确展示，新建/删除/上传操作 SHALL 提供双语文案与 aria 语义。

#### Scenario: 新建 App
- **WHEN** 用户在列表页填写 appId、name、description 并提交新建
- **THEN** 界面创建 App，成功后列表出现该 App 或跳转其详情

#### Scenario: 新建表单校验
- **WHEN** 用户提交缺失必填项或非法 appId 的新建表单
- **THEN** 界面阻止提交并展示内联校验错误

#### Scenario: 上传新版本
- **WHEN** 用户在详情页上传源包文件并提交
- **THEN** 界面登记新版本，版本历史新增该版本并自动刷新

#### Scenario: 删除 App
- **WHEN** 用户在详情页触发删除并确认
- **THEN** 界面删除该 App，之后列表不再显示该 App

#### Scenario: 版本历史展示
- **WHEN** 用户查看某 App 详情
- **THEN** 界面按版本倒序展示 release 历史（版本、digest、时间）

#### Scenario: 操作错误反馈
- **WHEN** 新建/上传/删除请求失败
- **THEN** 界面展示稳定错误提示且页面状态一致（不残留半成品）

#### Scenario: 空态引导
- **WHEN** 当前没有任何 App
- **THEN** 列表页展示空态并引导用户新建 App

