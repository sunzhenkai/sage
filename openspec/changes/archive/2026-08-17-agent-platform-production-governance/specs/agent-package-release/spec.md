## ADDED Requirements

### Requirement: 生产 Release、Adapter 与 Provider 供应链准入
每个进入生产的 Agent Package Release、Engine/Model Adapter 和 Capability Provider 构件 SHALL 使用不可变 digest 标识并携带受信签名、可验证 provenance、SBOM、license/vulnerability 结果和兼容声明；Registry publish、Run Admission 与 Host load SHALL 分别验证精确构件及当前 policy/revocation，未签名、签名无效、digest 不符、已撤销或不满足策略的构件 MUST NOT 发布、Admission 或执行。

#### Scenario: 已签名构件被替换
- **WHEN** Host 加载的 Adapter 或 Provider bytes 与 Spec 固定 digest 或 attestation 不一致
- **THEN** Host 拒绝加载并触发供应链安全告警，不回退到同名或 `latest` 构件

#### Scenario: 构件在 Spec 签发后撤销
- **WHEN** Release、Adapter 或 Provider build 因安全事件被撤销
- **THEN** 新 Admission 被阻止，运行中 invocation 按风险 policy kill/drain/cancel，系统不静默切换到其他 build

#### Scenario: 扫描或 provenance 服务不可用
- **WHEN** production publish 或 Admission 无法验证要求的 provenance、SBOM、license 或 vulnerability policy
- **THEN** 对应操作 fail closed，缓存结果只有在签名与 freshness policy 均满足时才可使用

### Requirement: 普通 Package 不获得原生执行权
普通 Agent Package SHALL 只声明版本化 Prompt、Skill、Schema、Capability requirement、Context plan、Model requirement、Policy、Budget 与 View metadata，MUST NOT 通过远程 include、脚本、原生模块、物理 endpoint、Secret、SQL/MQL 或 Provider metadata 绕过受信 Adapter/Provider 供应链。

#### Scenario: Package 包含动态代码或物理 endpoint
- **WHEN** Compiler 发现 native/script payload、远程 include、Secret bytes、数据库/表、SQL/MQL、namespace/task queue 或任意 endpoint
- **THEN** Release 构建失败并给出稳定诊断，不为该内容生成可发布 Release
