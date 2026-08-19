# model-broker-execution Specification

## Purpose
This specification defines the canonical model-broker-execution behavior, authority boundaries, compatibility rules, and fail-closed scenarios synchronized from the implemented T0005 delivery sequence.

## Requirements
### Requirement: Spec 约束的 Model Broker 路由
所有模型调用 MUST 由 Kernel 调用 Model Broker，并严格使用 immutable Spec 固定的 primary route、ordered fallback、provider/model identity、参数边界、数据策略、region 与 timeout。Engine MUST NOT 直接访问模型 provider，也不得增加未在 Spec 中的 route。

#### Scenario: Primary route 失败后有序回退
- **WHEN** primary route 以 Spec 允许回退的错误失败
- **THEN** Broker 仅按 Spec 中固定顺序尝试下一 route，并记录每次实际 provider/model/adapter identity

#### Scenario: 动态 alias 漂移
- **WHEN** provider catalog 的 active alias 在 Run admission 后变化
- **THEN** 已启动 invocation 继续使用 Spec 固定的 route identity，不静默采用新 alias

#### Scenario: Engine 请求未授权 route
- **WHEN** Engine proposal 指定 Spec route snapshot 之外的模型
- **THEN** Broker 拒绝请求且不连接该 provider

### Requirement: Model 调用的硬预算与 Usage Receipt
Model Broker MUST 在执行前获得 Consumption Ledger reservation，执行后生成包含稳定 model call/invocation ID、resolved model identity、实际 usage、cost、adapter build 与 provider request ID 的 immutable Usage Receipt，并以 receipt digest 幂等提交消费。没有有效 reservation 时 MUST NOT 发起计费调用。

#### Scenario: Usage commit 响应丢失
- **WHEN** provider 已返回且 Usage Receipt commit 成功，但响应在到达 Kernel 前丢失
- **THEN** 重试按相同 invocation ID 和 receipt digest 返回同一结算结果，不重复扣减

#### Scenario: 预算不足
- **WHEN** Ledger 无法为模型调用预留所需硬上限
- **THEN** Broker 不调用 provider，并返回稳定的预算拒绝错误

### Requirement: Model 请求边界、取消和安全策略
Model Broker MUST 执行 Kernel deadline 与 cancellation，限制输入/输出、token 和并发，并执行 Spec 固定的数据分级、DLP、no-training/no-retention、rate limit 与 circuit breaker 策略。必需 policy、credential、Ledger 或 provider identity resolution 不可用时 MUST fail closed。

#### Scenario: 调用期间取消
- **WHEN** Kernel cancellation 在 provider 调用期间生效
- **THEN** Broker 尽力取消 provider 请求、停止任何新 fallback，并返回包含已知 usage 状态的稳定结果

#### Scenario: 必需数据策略不可验证
- **WHEN** Broker 无法确认 route 满足 Spec 的 region 或 retention 策略
- **THEN** 请求在发送任何 prompt 前被拒绝

### Requirement: 可审计而非伪确定性的模型重放
当 provider 无法提供 immutable model revision 时，Broker MUST 在 Receipt 中记录 resolved identity、request ID、参数、adapter build 和 non-exact reason，并 MUST NOT 声称文本输出可逐字节确定重放。

#### Scenario: Provider 无 revision fingerprint
- **WHEN** 一次成功模型调用无法获得 immutable revision 或 fingerprint
- **THEN** Usage Receipt 标记 non-exact replay reason，同时保留足以审计实际 route 的 metadata
