## ADDED Requirements

### Requirement: 生产 Admission 原子治理 Gate
生产 Run Admission SHALL 在持久化可运行 `AgentTaskSpec` 和签发 `AgentExecutionEnvelope` 前，原子验证可信 OIDC principal/tenant、Release 与 Adapter/Provider 供应链、Policy/Grant/Approval、Secret references、tenant ACL、精确依赖 snapshots、runtime target、Consumption Ledger 初始 reservation 及所有 mandatory production dependency health；任一步失败 MUST NOT 生成可执行 Envelope，并 SHALL 补偿尚未消费的 reservation。

#### Scenario: 前置 change 或生产依赖未就绪
- **WHEN** 四个前置 change 的迁移/gate、Identity、Secret Manager、Policy/Revocation、Ledger、KMS/storage、target 或供应链验证任一未完成、不可用或不可验证
- **THEN** production Admission fail closed，记录稳定原因且生产状态保持 `NO-GO`

#### Scenario: Admission 在 reservation 后失败
- **WHEN** 初始预算 reservation 成功但后续 ACL、Approval、供应链或 Spec commit 校验失败
- **THEN** 不签发 Envelope，reservation 被幂等释放或进入可审计 orphan recovery，且不存在部分可运行 Spec

#### Scenario: 已 Admission 依赖后来撤销
- **WHEN** Spec 固定的 Tool、Provider、route 或构件被 live deny/revocation 或 kill switch 阻断
- **THEN** 后续 invocation 在 per-call authorization 处停止，不修改原 Spec，也不静默替换依赖
