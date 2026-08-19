# P0 控制面责任与环境隔离决策

状态：P0 已分配组件 Owner；组织内个人值班表在投产前由 P7 补充。

| 能力 | Accountable Owner | P0 决策 |
|---|---|---|
| Registry | Control Plane Owner | 版本化、受信任发布；业务输入不得写入基础设施字段 |
| Secret Manager | Security Owner | 仅通过 `secret_ref`/`connection_ref` 解析；状态和遥测不保存值 |
| OIDC | Identity Owner | API 验证 issuer/audience/expiry/scope，并形成 tenant scope |
| Artifact | Data Platform Owner | S3-compatible Port；业务状态只保存 `artifact_ref` |
| Agent State/PostgreSQL | Agent Core Owner | PostgreSQL 管 Session/Checkpoint/Run 引用，不保存密钥 |

隔离原则：development、staging、production 使用独立凭据与 Temporal Namespace；生产 tenant/data-classification 可进一步要求独立 Cluster。客户端不能接受用户或模型提供的 endpoint、Namespace 或 Task Queue。跨 Cluster 不静默迁移；已启动 Workflow 的目标在快照中固化。local profile 仅可使用仓库内明确的开发凭据。
