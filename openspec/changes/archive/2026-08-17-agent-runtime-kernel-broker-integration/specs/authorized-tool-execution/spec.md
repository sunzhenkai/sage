## MODIFIED Requirements

### Requirement: Fail-closed Tool execution pipeline
每个 Tool Call MUST 由 Kernel Capability callback 和 Capability Broker 发起，并按 schema 校验、有效 grant 计算、授权、credential 解析、执行、规范化、Effect Ledger commit、事件记录的顺序完成；policy、approval、revocation overlay、Consumption Ledger、必需 credential 数据或 tenant scope 任一不可用时 MUST 拒绝执行。Engine、Host 与 MCP Adapter MUST NOT 直接调用 Capability Provider，也不得把 observation 认定为已提交副作用。

#### Scenario: 未授权 Tool Call
- **WHEN** Tool 参数违反 schema、policy 不可用、授权拒绝、approval 无效、live revocation 生效、Ledger 无法预留 quota 或 tenant/resource scope 不匹配
- **THEN** Tool 不执行，并返回稳定且可观察的拒绝错误

#### Scenario: 未配置授权
- **WHEN** 未配置授权 policy
- **THEN** 只有同时存在于 Spec grant snapshot 中且显式 allowlist 的低风险只读 Tool 可以执行

#### Scenario: Engine 绕过 Capability callback
- **WHEN** Engine 或 Host 尝试直接调用 Tool Provider、MCP connection 或 ToolRuntime executor
- **THEN** dependency boundary 或 runtime guard 阻止调用，且不存在 Effect Ledger commit

## ADDED Requirements

### Requirement: Capability 权限单调收窄
每次 Tool Call 的有效权限 MUST 是 Spec grant snapshot、live deny/revocation overlay、principal/tenant/resource scope、approval scope/expiry 与当前 Ledger budget 的交集。Run 开始后的 live overlay MUST 只能撤权、缩小 scope 或 kill，MUST NOT 增加 Tool、Provider、操作或资源范围；扩大权限必须产生新的 admission、Attempt 与 Spec。

#### Scenario: Live overlay 新增 Tool
- **WHEN**运行中的 overlay 或控制面尝试把新 Tool 加入已 admission 的 Run
- **THEN**Capability Broker 忽略新增权限并拒绝该 Tool，直到新 Attempt 使用新 Spec

#### Scenario: 紧急撤权
- **WHEN**已 grant 的 Tool 在调用前被 live revocation 命中
- **THEN**Broker 拒绝执行并记录使用的 Spec grant 与 revocation 版本

### Requirement: MCP discovery 不产生 grant
MCP discovery、schema、description、endpoint metadata 与 transport availability MUST 只描述可发现能力，MUST NOT 创建或扩大 Capability grant。Capability Broker MUST 先按 Spec grant identity 和固定 provider/tool version 过滤 discovery 结果，再向 Engine 暴露有界 descriptor。

#### Scenario: MCP Server 新增 Tool
- **WHEN**MCP discovery 在 Run admission 后返回一个新增 Tool
- **THEN**该 Tool 不出现在 Engine 的可调用集合中，直接 proposal 也被拒绝

#### Scenario: 同名 Tool 版本变化
- **WHEN**MCP 返回与 Spec grant 同名但 provider 或 schema version 不同的 Tool
- **THEN**Broker 不把它视为已授权版本并拒绝调用

### Requirement: Broker enforcement 与 Effect authority 不可绕过
ToolRuntime MUST 是 Capability 执行 enforcement 组件，Effect Ledger MUST 是写副作用结果 authority。Engine 只能收到包含 committed effect receipt、denial 或 `effect_unknown` 的标准 observation，MUST NOT 自行提交 Effect、修改幂等 identity 或把超时解释为安全重试。

#### Scenario: 写 Tool 结果未知
- **WHEN**Provider 超时且无法确认副作用是否提交
- **THEN**Effect Ledger 记录 `effect_unknown`，Kernel 停止自动重试并把稳定 observation 返回 Engine

#### Scenario: 已提交 Effect 重放
- **WHEN**相同 semantic action identity 和 canonical input digest 被再次请求
- **THEN**Broker 返回已提交 Effect Receipt，不再次调用 Provider
