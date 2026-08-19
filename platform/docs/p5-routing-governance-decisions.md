# P5 可信多目标 Temporal Routing 治理决策

日期：2026-08-12  
状态：P5 开发实现决策已关闭；生产 Registry publication 仍必须取得真实人类批准。

> **批准边界：本文和相关代码可能由 AI 进行技术 review，但任何 AI review 都不是、也不得被记录为人类批准。测试中的 `dev-human-approver-fixture`/`human-change-approver` 仅验证状态机，不代表真实个人或生产授权。**

## 1. Owner、审批与发布

- **TaskType/TargetProfile Owner：** `Control Plane` 团队的 `control-plane-owner` 角色；Application、模型、普通用户和 Worker 均无写权限。
- **职责分离：** Owner 提交/发布，另一名具备 `temporal-registry-approver` 权限的真实人类审批；Owner 不能自批。`approve` 只接受认证会话引用，由受信任 `RegistryApprovalAuthorizer` 返回已验证 principal/roles；调用方不能提交 `approvalKind`、角色、approverId 或时间来自证人类身份。服务端生成 approvalId/approvedAt 并要求非空审计理由。AI review 无法通过该授权边界。
- **版本：** `TemporalRegistryBundle.v1` 聚合 `TaskTypeProfile.v1`、`TemporalTargetProfile.v1`、`RoutingPolicy.v1`。registryId 在 Registry 实例上固定；跨 submission/publication 的 artifact catalog 对 `(taskType,version)`、`(targetId,version)`、`(policyId,version)` 保存规范化 payload，同版本任何字段（含 credentialRef）变化均拒绝，必须 bump artifact version。route decision 同时记录 registry/policy/profile versions。
- **存储：** P5 dev 使用 `VersionedTemporalRegistry` 的 immutable publication store，制品源为受版本管理的 schema-valid bundle；每次重启仅可重新装载已审批版本。生产持久化后端必须以相同接口保存 immutable bundle、approval、publication 和 append-only audit；不能只保存“当前值”。生产 HA/备份属于 P7 gate，不改变本决策。
- **发布：** `submit -> distinct human approve -> owner publish`；任一步缺失都 fail closed。active pointer 只能指向已发布版本。
- **回滚：** 回滚只移动 active pointer 到历史上已审批且已发布的版本，不修改历史 bundle/approval/audit；新 Task 使用回滚后的 active version，已路由 Task 继续使用原 snapshot。
- **审计：** submission/approval/publication/rollback 记录 sequence、registry/version、actor、时间、理由及 rollback fromVersion。每个 route decision 记录 actor/context、全部候选及过滤原因、选择/拒绝结果与版本。

## 2. 隔离与目标身份

- Target 的完整身份是 `(targetId, targetProfileVersion, clusterId, endpoint, namespace, taskQueue, isolationKey, credentialRef)`；只有 Registry 可提供这些字段。
- production 的环境边界必须使用独立 Namespace；tenant/residency 需要更强隔离时使用独立 Cluster/Namespace。Task Queue 只做工作负载分派，不当作安全边界。
- P5 dev 的两个 profile 在同一 dev Cluster/Namespace 上使用不同 Task Queue，以验证真实多目标选择；这不是 production Cluster/Namespace 隔离证据。
- profile 的 `(clusterId, namespace, isolationKey)` 必须唯一，schema publication 拒绝 collision。

## 3. 约束、健康、容量和 fallback

1. Router 仅接受认证层提供的 `tenantId/environment/region/residency/actorId/contextId` 和可信 `taskType`。Task create HTTP 边界在 Fastify/AJV 可能执行 `removeAdditional` **之前**递归检查原始 body：根对象和 `slice` 均按显式白名单 fail closed；任何未知字段，以及 endpoint/address/host/namespace/taskQueue/task_queue/queue/cluster/target/credential/secret/connection 的大小写、下划线、连字符变体，一律返回 `400 TARGET_OVERRIDE_REJECTED`，不得调用 controller。
2. `TaskType.requiredResidencies` 定义该 TaskType 允许处理的认证数据驻留域；不在列表时所有候选记录 `task-type-residency-not-allowed` 并 fail closed。随后候选按 enablement、TaskType allow-list、environment、tenant allow-list、region、target residency、health、minimum capacity、maximum backlog 过滤。
3. health/capacity/backlog/priority/fallbackRank 仅来自已发布控制面数据；用户或模型不能写入。P5 不声称动态负载均衡。
4. 选择顺序固定为 `priority desc -> fallbackRank asc -> backlog asc -> targetId lexical`，并写入 explanation。
5. fallback 只允许在 **首次 start 前** 从合法候选中选择；snapshot 持久化后无 fallback、迁移或跨 Cluster 重建。无候选返回 `ROUTING_UNAVAILABLE`。reservation 后 provider/connector 建连失败返回 `WORKFLOW_START_OUTCOME_UNKNOWN`（HTTP 503、retryable）并保持 `start_pending`；`TARGET_CLUSTER_UNAVAILABLE`/`target_unavailable` 只表示 Workflow start 被明确拒绝且 authoritative describe 证明不存在。

## 4. Snapshot、凭据和故障语义

- `task_routing` 在 Workflow start 前原子写入完整 `WorkflowTargetSnapshot` 和 `RouteDecision`；DB trigger 禁止修改 tenant/task/workflow/taskType/snapshot/decision/createdAt。
- reservation 原子保存 snapshot、route decision 与完整不可变 `WorkflowStartEnvelope`（workflowId/taskQueue/snapshotId/inputRef/TaskType/slice limits）；同 taskId 的重试请求不得改变 envelope。`start_pending` 的安全重试只能使用该 envelope。timeout/transport/describe/store 写失败均是结果未知，保持 `start_pending` 并按同一 workflowId 有界 reconcile；describe 证明存在后只补记 started。只有 start 被明确拒绝且 authoritative describe 证明不存在时才标记 `target_unavailable`，绝不因一次 describe 失败进入终态或选择第二 Cluster。
- create/query/signal/cancel/retry 都先从 durable `task_routing` 读取 snapshot，再创建对应 client。Registry 更新或回滚不影响已有 Task。
- Client Factory 只从 snapshot 读取 `credentialRef`，调用 `CredentialProvider` 动态解析；`CredentialLease.value` 所有权转移给 Factory，connector 仅借用同一 buffer，finally 清零原 lease 与所有别名。Factory 不保留未受信任 cause，对外只有稳定脱敏 code；DB、route explanation、API body、错误和日志不得含 credential value。默认 Temporal SDK 仅接受不可清零的 JavaScript apiKey string，这是明确的内存限制：连接进程必须最小权限、不得记录字符串，并尽快释放连接；其可变源 bytes 仍立即清零。
- Temporal History 继续是执行事实源；Task projection 可滞后。P4 的 effect_unknown/cancel/idempotency 语义保持不变。
