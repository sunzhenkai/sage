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
