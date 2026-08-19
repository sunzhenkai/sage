## ADDED Requirements

### Requirement: Canonical dependency boundary 静态扫描
系统 MUST 对 canonical contracts、canonical ports、public type declarations、生成 Schemas/JSON serialization surface 和 package import graph 执行 dependency boundary/static scan。Canonical surface MUST NOT 包含 Pi、Temporal、Web/DOM、数据库 client/ORM/driver 或 MCP SDK 的 imports、类型、实现对象或框架专属序列化字段；adapter/audit 命名空间中的稳定 opaque refs 不得反向引入 SDK 类型。

#### Scenario: Canonical surface 保持框架无关
- **WHEN** scanner 检查全部 canonical package graph、public types 和 Schemas
- **THEN** 未发现 Pi、Temporal、Web、DB 或 MCP SDK 泄漏，扫描报告保存规则集和源码 digest

#### Scenario: SDK 类型进入公共契约
- **WHEN** canonical port 参数、公开类型或 Schema 字段引用具体 SDK 类型或生成对象
- **THEN** scanner 报告精确依赖路径并使架构 conformance Gate 失败

#### Scenario: 仅通过重命名隐藏泄漏
- **WHEN** import 被包装或字段被重命名但 public dependency graph 或 serialization shape 仍携带具体框架语义
- **THEN** AST/type/schema 多层扫描仍将其识别为 boundary violation

### Requirement: Reference workload 依赖方向扫描
系统 MUST 验证 `Evidence Digest` 只依赖 Release、Skill、Capability、Schema、Policy、View 的公共入口及批准的 fixtures，不得依赖 Kernel internals、Host apps、Temporal Adapter、数据库实现或 Chat/Task domain。新增核心泄漏 allowlist MUST NOT 被 final Gate 接受。

#### Scenario: Workload 依赖符合边界
- **WHEN** scanner 从 reference workload package roots 构建反向依赖图
- **THEN** 所有依赖终止于允许的公共平台面或批准的 test fake

#### Scenario: Workload 导入内部实现
- **WHEN** workload 直接导入 Kernel private module、Host、Temporal workflow、DB adapter 或 Chat/Task package
- **THEN** scanner 阻断构建并报告最短违规依赖链

### Requirement: 最终 System Model
系统 MUST 基于终版架构文档和已验收实现生成可机器校验的最终 System Model。模型 MUST 表达 components、canonical/adaptor ports、authorities、trust boundaries、data classifications、allowed dependency directions、runtime/deployment mapping 和 failure/recovery ownership，并为每个元素分配稳定 ID。模型 MUST 通过 schema、引用完整性、authority 唯一性和禁止依赖规则校验。

#### Scenario: System Model 完整有效
- **WHEN** 最终模型由受版本控制的输入生成并执行 validator
- **THEN** 所有引用可解析、每项受管事实只有一个 authority、依赖方向合法且模型 digest 被记录

#### Scenario: Authority 重复或缺失
- **WHEN** Lifecycle、Spec、Effect、Usage、Artifact、Checkpoint、Secret 或 Projection 事实存在多个 authority 或无 authority
- **THEN** 模型 validation 失败并阻止渲染和 baseline 晋级

### Requirement: Runtime DSL 与渲染图由模型投影
系统 MUST 从已验证 System Model 投影版本化 Runtime DSL，并由 DSL 可重复渲染运行图；手写 Mermaid 或图片 MUST NOT 作为模型 authority。DSL 与图 MUST 展示 Interactive/Durable paths、Kernel/Engine、Broker、Coordinator、各 authority store、trust boundary、主要数据 refs 和 failure/recovery edges。

#### Scenario: 可重复投影与渲染
- **WHEN** 使用固定 generator 版本对同一 System Model 运行两次
- **THEN** Runtime DSL 的 canonical digest 和归一化渲染结构一致，并记录 generator 版本

#### Scenario: 图包含模型外组件或遗漏强制边
- **WHEN** DSL/渲染图与 System Model element/edge 集合不一致
- **THEN** projection validator 失败，图不得进入最终验收证据

### Requirement: Formal Architecture Review
系统 MUST 对最终 System Model、Runtime DSL、渲染图、实现依赖图和运行证据执行 Formal Architecture Review。Review MUST 至少检查 canonical authority、trust/security boundary、failure/recovery、state ownership、deployment mapping、data flow、framework leakage、Interactive/Durable 等价、Engine replaceability、production readiness 和开放问题处置；每项 finding MUST 有 severity、evidence refs、owner 和 disposition。

#### Scenario: Formal Review 无阻断 finding
- **WHEN** 所有必审规则通过且不存在未关闭的 critical/high finding
- **THEN** Review 状态为 `PASS` 并引用确切模型、代码和验证证据 digests

#### Scenario: 存在阻断 finding
- **WHEN** Review 发现 authority 冲突、trust boundary 绕过、不可恢复故障或 canonical SDK leakage
- **THEN** Review 状态为 `FAIL`，总 Gate 为 `NO-GO`，且 finding 不得以无证据的 accepted risk 关闭

### Requirement: 文档模型实现测试一致性矩阵
系统 MUST 生成机器可读 traceability matrix，把每条终版架构不变量关联到设计章节、System Model element IDs、Runtime DSL nodes/edges、实现 owner/path、OpenSpec Requirement、test case IDs 和 evidence digests。Consistency checker MUST 检测 missing、dangling、contradictory 和 stale links，并核对文档声明的组件、authority 与实际依赖图。

#### Scenario: 全链路一致
- **WHEN** checker 对最终文档、模型、DSL、实现清单、specs 和证据运行
- **THEN** 每条强制不变量至少有一个有效实现映射和自动验证证据，且不存在矛盾链接

#### Scenario: 文档声明与实现不符
- **WHEN** 文档声明 Coordinator 不含数据库依赖但实现依赖图显示直接 DB import
- **THEN** consistency checker 报告矛盾并阻止 Formal Review 通过

#### Scenario: 模型元素没有验证证据
- **WHEN** 某个强制 authority 或 trust boundary 没有 test/evidence link
- **THEN** 该链接状态为 missing，架构 conformance Gate 失败

### Requirement: 机器可读最终 Gate manifest
系统 MUST 生成机器可读 Gate manifest，至少聚合五项依赖、reference workload diff、双 Engine conformance、Interactive/Durable 等价、完整 fault matrix、explainable replay、Projection rebuild、History replay、dependency scans、System Model validation、Runtime DSL/render validation、Formal Review、traceability consistency、生产 readiness 和 evidence freshness。每个强制项状态 MUST 仅为 `PASS`、`FAIL` 或 `BLOCKED`，并包含 evidence ref/digest、owner 和时间。

#### Scenario: 所有强制 Gate 通过
- **WHEN** 每个强制项均为 `PASS`、证据 digest 可验证且在有效 freshness 窗口内
- **THEN** 聚合结果为 `GO` 并产生唯一 decision record digest

#### Scenario: Gate 失败或证据过期
- **WHEN** 任一强制项为 `FAIL/BLOCKED`、缺少 evidence 或超过 freshness 窗口
- **THEN** 聚合结果为 `NO-GO` 并列出 blocker、owner、修复条件和 evidence ref

#### Scenario: 本地 fake 替代生产证据
- **WHEN** conformance fake 通过但序列 5 要求的真实 Identity、Secret、Policy、Ledger、Artifact、Coordinator 或可观测证据缺失
- **THEN** production readiness 项为 `BLOCKED` 且总结果保持 `NO-GO`

### Requirement: Validated baseline fail-closed 晋级
目标架构状态 MUST 只在最终 Gate 为 `GO` 后由独立、可审计的晋级步骤从 `Proposed final architecture baseline` 更新为 `Validated architecture baseline`，并写入 decision record 和 evidence manifest refs。任何 `NO-GO` MUST 保持原状态；测试、生成器或人工评审不得绕过聚合 Gate 直接升级。

#### Scenario: 合法晋级
- **WHEN** 可验证的 Gate decision 为 `GO` 且晋级步骤校验目标文档 revision 与 decision inputs 未变化
- **THEN** 系统更新 baseline 状态、记录验证时间和 evidence refs，并保留此前设计历史

#### Scenario: NO-GO 时尝试晋级
- **WHEN** Gate 不是 `GO` 或 decision inputs 已变化
- **THEN** 晋级步骤拒绝写入，目标文档继续保持 `Proposed final architecture baseline`

#### Scenario: 人工豁免缺少证据
- **WHEN** 操作者尝试以口头批准、`WARN` 或未签名 override 将失败项视为通过
- **THEN** Gate 拒绝 override，并在 `NO-GO` 报告记录该尝试

### Requirement: 架构证据可重复与可归档
最终 System Model、Runtime DSL、渲染图、Formal Review、traceability matrix 与 Gate manifest MUST 记录源码 revision、输入文档 digest、generator/validator 版本、生成命令或等价 invocation metadata 和产物 digest，并 MUST 可在隔离环境中重复校验。二进制渲染产物 MUST 有对应的文本 DSL 和模型来源。

#### Scenario: 隔离环境复核架构证据
- **WHEN** 评审人取得归档输入、工具版本和 invocation metadata
- **THEN** 可重新验证模型、投影 DSL、归一化渲染结构、Review 与 Gate decision

#### Scenario: 渲染图无模型来源
- **WHEN** 提交的 SVG/PNG 没有关联已验证 DSL 和 System Model digest
- **THEN** 该图不计入验收并使架构资产 Gate 为 `BLOCKED`
