## ADDED Requirements

### Requirement: Admission 使用 immutable Catalog revision 解析精确 Model 与 Provider build
Provider/Model Catalog SHALL 为 Run Admission 提供服务端、immutable revision-bound 的解析接口，将 Release 的 Model requirements、tenant/environment/residency/data-handling policy 和允许的 fallback policy 解析为精确 primary Model build、有序精确 fallback Model builds、Provider adapter build digests、参数 digest 与 data-handling policy digest。逻辑 model ID、`latest`、浮动 alias、未快照 fallback 或 browser/profile metadata MUST NOT 作为已签发 `AgentTaskSpec` 的运行 identity。

#### Scenario: 精确 Model route 解析
- **WHEN** Admission 在一个 immutable Catalog revision 上提交合法 Model requirements 和治理约束
- **THEN** Catalog 返回 revision id、精确 Model/Provider build identities、digests 和有序 fallback，Admission 将它们固化到 Spec

#### Scenario: Alias 无法固定
- **WHEN** 逻辑 model alias 在选定 revision 中不存在、歧义、已撤销或不能解析到已验证 Provider build
- **THEN** Catalog 返回稳定不可用结果，Admission 不创建可运行 Spec且不允许 Host 运行时重解析

#### Scenario: active Catalog 在 admission 后变化
- **WHEN** Spec 已固定 Model/Provider builds，随后 active Catalog revision 激活不同 build
- **THEN** 既有 Attempt 继续使用原精确 builds；只有新 Attempt 重新 admission 后观察新 revision

### Requirement: Catalog 解析失败时 fail closed 且不泄露连接信息
Admission resolution SHALL 只使用已验证 immutable snapshot/projection；当没有合法 snapshot、projection 无法重建、所需 artifact 不可信或精确 build 不可用时 MUST fail closed。解析响应和审计 MUST NOT 包含 API key、profile Secret、上游 response body、内部 endpoint 或不必要的 principal identity。

#### Scenario: Catalog 无可用 immutable revision
- **WHEN** Admission 请求解析 Model route 但 Catalog 无 active/LKG immutable revision或 projection integrity 失败
- **THEN** 返回稳定 `MODEL_UNAVAILABLE`/`CATALOG_PROJECTION_UNAVAILABLE`，不返回 stale mutable alias、不签发 Envelope

#### Scenario: 安全的解析审计
- **WHEN** Model route 解析成功或失败
- **THEN** 审计仅记录 requirements digest、Catalog revision、选择/拒绝的 artifact identities 和 bounded reason，不记录 credential 或物理连接详情
