## MODIFIED Requirements

### Requirement: Workspace payload 与 secret隔离

Provider/profile/catalog metadata SHALL只影响配置UI与用户显式选择的 Chat 运行时，不得加入Task create/signal/cancel/retry payload；Task 相关schema SHALL继续拒绝additional properties。Chat submit与retry payload SHALL允许可选的ephemeral provider route（adapterKind、HTTPS baseUrl、modelId与当前tab API key），且仅当次Run在内存中使用：SHALL NOT持久化route或key到localStorage、sessionStorage以外的存储、PostgreSQL或日志。Browser SHALL不把API key转发到Catalog sync或Pi harness以外的任何端点；未选择profile时Chat payload SHALL不含任何provider字段。

#### Scenario: Chat submit 携带显式 route

- **WHEN**用户选择了executionAvailable profile且当前tab存在secret后发送Chat消息
- **THEN**请求body仅包含parts与该profile对应的provider route（adapter/base URL/model/key），服务端不持久化route

#### Scenario: 未选择 profile 的 Chat payload

- **WHEN**用户使用默认本地运行时发送消息、执行promotion或Task controls
- **THEN**捕获的request body不含provider、model、profile、base URL、API key，实际runtime仍为本地Pi harness

#### Scenario: Chat与Task boundary negative test

- **WHEN**用户选择了含provider、model、base URL和secret的profile后执行promotion与Task controls（以及未选择profile时的Chat提交）
- **THEN**捕获的request body不含provider、model、profile、base URL、API key、target、actor或roles；只有用户显式选择的Chat submit/retry例外地携带provider route，实际Task runtime仍为本地Pi
