# authorized-tool-execution Specification

## Purpose
TBD - created by archiving change sage-p2-secure-state-artifact-and-observability-foundation. Update Purpose after archive.
## Requirements
### Requirement: Fail-closed Tool execution pipeline
Every Tool Call SHALL complete canonical schema validation, trusted identity and tenant validation, capability Grant/live revocation evaluation, Approval and Consumption Ledger checks, Effect claim for write-capable Tools, sandbox/egress enforcement where required, execution, normalized receipt commit, and correlated event recording in that order; unavailable or unverifiable policy, revocation, Approval, Ledger, required credential, sandbox, egress, Tool build, or Provider build data SHALL deny execution.

#### Scenario: Unauthorized Tool Call
- **WHEN** Tool parameters violate schema, identity/tenant/scope mismatches, Approval digest is missing or expired, live policy denies, budget is unavailable, or any mandatory enforcement dependency is unavailable
- **THEN** the Tool is not executed, no write Effect is claimed without authorization, and a stable observable denial receipt is returned

#### Scenario: Unconfigured authorization
- **WHEN** no production authorization policy is configured
- **THEN** production Tool execution is denied; only a non-production profile may execute explicitly allowlisted low-risk read-only Tools under a versioned policy

#### Scenario: SSRF or DNS rebinding target
- **WHEN** a sandboxed Tool resolves, redirects, or connects to a non-allowlisted, private, loopback, link-local, reserved, or metadata target
- **THEN** egress is blocked before connection and the denial is correlated to the Tool invocation without exposing credentials

### Requirement: Idempotent and unknown-effect Tool results
Write-capable Tools SHALL derive a stable `semantic_action_id`, atomically claim a fenced Tool Effect Ledger record before external execution, and commit an immutable normalized effect receipt afterward; replay of the same action and digest SHALL return the committed receipt, a different digest SHALL return `EFFECT_CONFLICT`, and an indeterminate remote commit SHALL persist `EFFECT_UNKNOWN` and stop automatic retry until an authorized human resolution is recorded.

#### Scenario: Duplicate known side effect
- **WHEN** the same `semantic_action_id` and canonical input digest is delivered again after a known committed effect
- **THEN** the Tool does not execute the side effect twice and returns the immutable committed effect receipt

#### Scenario: Conflicting semantic action
- **WHEN** an existing `semantic_action_id` is delivered with a different canonical input digest, Tool version, or Provider binding
- **THEN** execution is rejected with `EFFECT_CONFLICT` and the existing authority record is not overwritten

#### Scenario: Timeout after uncertain commit
- **WHEN** a Tool times out after the remote system may have committed and the Provider cannot prove the outcome by idempotency key
- **THEN** Tool Effect Ledger records `EFFECT_UNKNOWN`, automatic retry/fallback is prohibited, and the Task exposes the manual resolution state

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
