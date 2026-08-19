## ADDED Requirements

### Requirement: 声明式 AgentPackage schema 与安全边界
系统 SHALL 提供显式 major 版本、严格校验且有界的 `AgentPackage` schema，只允许 metadata、agent definition、Skill requirements、Capability requirements、Context plan、Model requirements、输入/输出 schema、Policy、Budget、eval cases、可选 plan hints 和 View metadata。普通 Package MUST NOT 包含或加载动态原生代码、WASM/脚本、远程 include、Secret/credential bytes、物理 endpoint/namespace/task queue、数据库或表标识、SQL/MQL、自定义前端代码或基础设施 SDK 配置。

#### Scenario: 合法声明式 Package
- **WHEN** 作者提交只包含允许字段且满足大小、深度、标识符和 schema 约束的 `AgentPackage.v1`
- **THEN** Compiler 接受该源并进入依赖解析，且 Package 本身不获得身份、Secret、target 或执行 authority

#### Scenario: Package 试图注入运行能力
- **WHEN** Package 包含原生模块、脚本、远程 include、Secret、物理 endpoint、数据库标识或 SQL/MQL
- **THEN** Compiler 以稳定 `PACKAGE_FORBIDDEN_CONTENT` 拒绝整个构建，不解析或执行该内容，也不生成 Release

#### Scenario: 未知或无界字段
- **WHEN** Package 包含未知关键字段、重复 key、超限嵌套或超限文本
- **THEN** strict reader 以稳定 `PACKAGE_INVALID` 拒绝输入，不以忽略字段方式接受潜在 authority

### Requirement: 可复现依赖解析与 canonical lock
Compiler SHALL 仅从受信、版本化 catalog 解析 Engine compatibility、Skill、Context resolver/schema、Capability/Tool schema、Model requirements、Policy、输入/输出 schema 和 Budget 依赖，并 SHALL 将每项解析为精确版本、immutable revision 或 digest。Compiler SHALL 生成 canonical `AgentPackageLock`，绑定 Package source digest、compiler/resolver build 和所有解析结果；浮动 range、`latest`、未快照 alias 或无法验证的依赖 MUST NOT 进入 Release。

#### Scenario: 相同输入可复现构建
- **WHEN** 相同 Package source、compiler/resolver build 和 catalog revisions 被重复构建
- **THEN** 系统生成字节等价的 canonical lock、相同 lock digest 和相同 content digest

#### Scenario: 依赖范围解析为精确版本
- **WHEN** Package 声明一个允许的 Skill 或 Model compatibility range 且 catalog 有唯一合法解析结果
- **THEN** lock 记录解析后的精确 artifact identity、版本和 digest，而不保留运行时再解析的浮动选择

#### Scenario: 依赖不可解析或发生歧义
- **WHEN** 任一依赖不存在、已撤销、签名无效、不兼容或无法唯一解析
- **THEN** Compiler 以稳定 `DEPENDENCY_UNRESOLVED` 失败，不生成部分 lock 或 Release

### Requirement: SBOM、provenance 与 signature 供应链证明
每个 Release build SHALL 生成覆盖 Package 与全部交付依赖的 SBOM、包含 source/lock/compiler/resolver/build inputs 的 provenance，并 SHALL 产生覆盖 content digest、lock digest、SBOM digest、provenance digest 和 compiler build identity 的 signature。缺失、无效、过期、已撤销或不满足 license/vulnerability policy 的证明 MUST 阻止 Release 发布和后续 admission。

#### Scenario: 完整可信证明
- **WHEN** build 的 SBOM、provenance 和 signature 完整且由受信 issuer 对正确 digests 签发
- **THEN** Release builder 生成可提交 Registry 的 attested `AgentPackageRelease`

#### Scenario: 证明与内容不匹配
- **WHEN** signature、SBOM 或 provenance 引用的任一 digest 与 canonical build output 不一致
- **THEN** 验证失败且 Release 不可发布或 admission，错误响应不泄露签名私钥或内部构建路径

#### Scenario: 可执行 Adapter 独立供应链
- **WHEN** Package 需要 Engine、Provider 或 Capability Adapter
- **THEN** Release 只引用独立 artifact catalog 中已签名扫描的精确 build digest，不把可执行 bytes 嵌入普通 Package

### Requirement: 不可变 AgentPackageRelease
Compiler SHALL 从已验证 lock 和 attestations 生成内容寻址的 `AgentPackageRelease`，至少绑定 release/package identity、版本、owner、kernel contract major、Engine compatibility、Skill/Capability/Context/Model/schema/policy/budget digests、lock/content digest、SBOM/provenance/signature refs 和 compiler build。Release 创建后 MUST 是不可变的；任何声明、依赖、证明或构建 identity 变化 SHALL 生成新的 release identity。

#### Scenario: Release 内容寻址
- **WHEN** 一个已验证 Package build 完成
- **THEN** Release identity 可由 canonical content 与证明 digests 校验，且所有运行依赖均可追溯到精确 artifact

#### Scenario: 同版本内容覆盖
- **WHEN** 发布者试图用相同 package/version 覆盖不同 content、lock 或 attestation digest
- **THEN** 系统拒绝 mutation 并要求创建新的 Release，原 Release 保持可读取和可验证

#### Scenario: Release 不包含动态运行 authority
- **WHEN** Release 被读取或交给 Admission
- **THEN** Release 不包含 principal/role、Secret bytes、物理 runtime target、live grant 或 remaining budget，以上内容只能由 admission 的可信 authority 绑定
