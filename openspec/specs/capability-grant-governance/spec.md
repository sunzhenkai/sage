# capability-grant-governance Specification

## Purpose
This specification defines the canonical capability-grant-governance behavior, authority boundaries, compatibility rules, and fail-closed scenarios synchronized from the implemented T0005 delivery sequence.

## Requirements
### Requirement: 可信生产身份链与租户边界
系统 SHALL 只接受经配置 issuer、audience、签名、时效与重放校验的 OIDC human/service principal，并 SHALL 在 Admission 固化不可由 Package、模型、Skill、MCP metadata、Tool output 或调用方字段覆盖的 `principal_ref`、`tenant_id` 与最大 scope；Host 对外调用 MUST 使用绑定 workload、tenant、environment、audience 与短 TTL 的 workload identity。

#### Scenario: 调用方伪造租户
- **WHEN** 认证 token 的可信 tenant claim 与请求、Package 或 Tool 参数中的 tenant 不一致
- **THEN** Admission 拒绝请求，不签发 Spec 或 Envelope，并记录不含 token 内容的安全审计

#### Scenario: 工作负载身份过期
- **WHEN** Broker 调用时 workload identity 已过期、audience 不匹配或无法交换
- **THEN** 外部调用不执行，系统返回稳定的 fail-closed 错误且不回退到共享静态 credential

### Requirement: Capability Grant 单调收窄
每次 Tool 调用的有效权限 MUST 是 Spec Grant Snapshot、live deny/revocation overlay、principal/tenant/resource scope、Approval binding/expiry 与 Consumption Ledger 可用预算的交集；live overlay SHALL 只能 deny、缩小 scope 或 kill，MUST NOT 向已 Admission 的 Spec 添加 Tool、Provider、route 或资源权限。

#### Scenario: Tool 在 Admission 后被撤销
- **WHEN** Spec 已允许的 Tool 或 Provider build 出现在有效 live revocation 中
- **THEN** 下一次调用在执行前被拒绝并产生关联 revocation version 的 authorization receipt

#### Scenario: MCP discovery 出现新 Tool
- **WHEN** MCP server 在 Spec 签发后新增或修改 Tool schema
- **THEN** 原 Spec 不获得该 Tool 或新 schema 权限，只有新 Admission 生成的新 Spec 才可引用

### Requirement: Approval 绑定规范化语义动作
生产写操作或策略标记的高风险操作 MUST 持有 Approval；Approval digest SHALL 绑定 tenant、principal、Tool 与 Provider build、canonical input digest、risk、resource scope、environment、数量或成本上限、签发策略和 expiry，任一绑定字段变化或过期 MUST 重新批准。

#### Scenario: 批准后参数发生变化
- **WHEN** 执行前重新规范化的参数 digest 与 Approval digest 不一致
- **THEN** Broker 拒绝执行且不得复用旧 Approval、Effect claim 或预算 reservation

#### Scenario: Approval 在排队期间过期
- **WHEN** Tool 调用到达执行点时 Approval 已过期
- **THEN** 调用 fail closed 并返回可观察的 `APPROVAL_EXPIRED`，不因调用已排队而放行

### Requirement: Sandbox 与 egress 防护
bounded generic 或 infrastructure Tool SHALL 在非特权、资源有界的隔离 sandbox 中执行，网络默认拒绝；允许的 egress MUST 经受控代理按 scheme/host/port/path 校验，并 MUST 在解析及每次实际连接/重定向时阻断 loopback、private、link-local、reserved、metadata endpoint、SSRF 与 DNS rebinding 目标。

#### Scenario: DNS rebinding
- **WHEN** allowlisted hostname 在首次校验后解析或连接到 private、link-local 或 metadata IP
- **THEN** egress proxy 在建立连接前拒绝请求并终止 Tool invocation

#### Scenario: 重定向逃逸
- **WHEN** 允许的公网 URL 重定向到未允许 host、port、scheme 或受限 IP
- **THEN** 每跳重新授权失败，sandbox 不跟随重定向且记录安全事件

### Requirement: 授权依赖故障与 kill switch
Identity、Policy、Revocation、Approval、Ledger、sandbox 或 egress enforcement 的必需依赖不可用、超时或版本不可验证时，系统 SHALL fail closed；kill switch SHALL 支持 global、tenant、Release、Provider、Tool 与 model route scope，并 SHALL 只阻止新工作或发出受控取消，不删除或改写已提交 authority 数据。

#### Scenario: Revocation 服务不可用
- **WHEN** 写 Tool 调用无法取得满足 freshness policy 的 live deny/revocation 决策
- **THEN** 调用不执行，已缓存 allow 不能绕过 fail-closed 规则

#### Scenario: 紧急关闭 Provider
- **WHEN** 授权 Owner 激活某 Provider build 的 kill switch
- **THEN** 新 invocation 被阻止，运行中工作按记录的 drain/cancel policy 处理，已提交 Effect 与 Usage receipt 保持不变
