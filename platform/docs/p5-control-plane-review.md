# P5 Control Plane 技术 Review

日期：2026-08-12  
评审角色：Control Plane Owner（AI 技术视角）  
结论：**技术实现 PASS；不构成人类 Registry publication 批准。**

> 本 review 由 AI 工程代理按 Control Plane Owner 视角执行。它不是人类批准，不授予 production publication 权限，也不能作为真实 approver 证据。生产发布必须由外部身份系统认证、职责分离且具备 `temporal-registry-approver` 权限的真实人类完成。

## Review 结果

- **输入信任边界：PASS。** Task create 在 AJV `removeAdditional` 前递归检查原始 body；根对象与 nested `slice` 仅允许 schema 白名单，拒绝 endpoint/address/host/namespace/taskQueue/task_queue/queue/cluster/target/credential/secret/connection 的大小写、下划线、连字符变体及任意未知字段；拒绝时固定 `400 TARGET_OVERRIDE_REJECTED` 且 controller invocation=0。Router 保持第二道 fail-closed 边界。
- **选择与解释：PASS。** 两个 TaskType/Target/Queue；TaskType required residency、tenant/environment/region/target residency、health/capacity/backlog 均进入候选解释；固定 priority/fallback/backlog/targetId 排序；无候选为 `ROUTING_UNAVAILABLE`。
- **start 故障语义：PASS。** start envelope 与 snapshot 原子持久化。timeout/transport/describe/store 写失败，以及 credential provider/connector 首次瞬时失败，均为 `WORKFLOW_START_OUTCOME_UNKNOWN` 并保持 `start_pending`；后续 create/reconcile 仅使用原 immutable snapshot/envelope/workflowId 恢复。仅明确 Workflow start rejection + authoritative not-found 可进入 `target_unavailable`；无第二 target start。
- **Snapshot：PASS。** 完整身份含 isolationKey；PG trigger 同时保护 snapshot/decision/startEnvelope；Registry publish/rollback 后旧 Task 的 create/query/signal/cancel/retry 继续使用原 snapshot。
- **Credential：PASS。** 仅持久化 `secret://` ref；provider 原 lease buffer 在 success/failure 后清零；未受信任 cause 不穿越 Factory；缓存键包含 cluster/endpoint/namespace/credentialRef/profile version。SDK JavaScript string 限制已明确记录。
- **治理：PASS。** approve 只接受 authentication reference，由 authorizer 验证 principal/role；无 caller-supplied human claim。服务端时间/ID、非空理由、职责分离、固定 registryId、artifact 版本不可变、append-only audit 与 approved rollback 均有测试。
- **P4 回归：PASS。** P4 integration 6/6；SingleTarget Workflow/Activity、重投递、effect_unknown、cancel/idempotency 语义保持。

## 生产前保留 Gate

- dev authorizer 和 approver identity 是测试 fixture，不是真实批准。
- 两个 Target 共用 dev Cluster/Namespace，仅证明可信 routing/Queue 行为；生产隔离、Registry durable HA/backup、真实 identity provider、mTLS/RBAC/secret backend 属 P7 gate。
- Temporal SDK apiKey 的不可清零 JS string 需要最小权限连接进程、禁止日志与连接生命周期约束。
