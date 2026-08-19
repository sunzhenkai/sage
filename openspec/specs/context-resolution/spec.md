# context-resolution Specification

## Purpose
This specification defines the canonical context-resolution behavior, authority boundaries, compatibility rules, and fail-closed scenarios synchronized from the implemented T0005 delivery sequence.

## Requirements
### Requirement: 受 Spec 限制的 Context 解析
Context Resolver MUST 只解析 immutable Spec 的 ContextPlanSnapshot 允许的数据源、revision policy 和 namespace，并对每个引用执行 tenant ACL、principal/resource scope、source revision、sensitivity 与可用性检查。合法 URI 或可发现资源本身 MUST NOT 构成读取授权。

#### Scenario: 跨租户 ContextRef
- **WHEN** Context plan 或来源返回属于其他 tenant 的引用
- **THEN** Resolver 拒绝读取、记录结构化 denial，且不把内容暴露给 Engine

#### Scenario: 未在 Context plan 的来源
- **WHEN** Engine 请求解析 Spec 未允许的数据源
- **THEN** Resolver 拒绝请求且不访问该来源

### Requirement: 有界 Context view 与 provenance
Resolver MUST 在 Spec 的 context byte/token 上限内执行裁剪、摘要、去重和排序，并返回有界 Engine view 及 immutable Context Receipt。Receipt MUST 记录实际 source refs/revisions、变换、provenance、sensitivity、截断和降级状态；完整大内容 MUST 以已提交 ArtifactRef 引用而非进入普通 Event 或 Receipt。

#### Scenario: Context 超过上限
- **WHEN** 候选 Context 超过 Spec 的 byte 或 token 上限
- **THEN** Resolver 按固定策略裁剪或摘要，Receipt 明确记录截断，且返回 view 不超过上限

#### Scenario: 大来源快照
- **WHEN**审计所需的来源快照超过 inline policy
- **THEN** Resolver 仅在 Artifact 成功 finalize 后把 ArtifactRef 写入 Context Receipt

### Requirement: Context 内容不能改变执行 authority
来自外部来源、Memory、Tool output 或 Artifact 的 Context MUST 一律视为不可信数据，MUST NOT 修改 Spec、principal、tenant、grant、approval、Model route、runtime target、policy 或 Kernel limits。Resolver 和 Kernel MUST 隔离内容指令与平台控制字段。

#### Scenario: Context 中的权限提升指令
- **WHEN**解析内容声称应忽略平台策略或授予新 Tool
- **THEN**该内容仅作为不可信文本进入有界 view，不改变任何授权或 Kernel 行为

### Requirement: Context 失败与降级可观察
当来源、ACL、Artifact 或 Resolver 不可用时，Resolver MUST 按 Spec 明确策略返回 fail、wait 或有限降级，并记录稳定错误与 Receipt；没有显式允许时 MUST fail closed，且 MUST NOT 伪造完整 Context。

#### Scenario: 必需来源不可用
- **WHEN**必需 Context 来源超时且 Spec 未允许降级
- **THEN**invocation 以稳定 Context 错误停止，不调用 Engine 的下一认知步骤

#### Scenario: 允许有限降级
- **WHEN**可选来源不可用且 Spec 显式允许降级
- **THEN**Resolver 返回不包含该来源的有界 view，并在 Receipt 中标记缺失和降级原因
