# P4 单目标 Temporal Task 架构评审

日期：2026-08-12  
结论：**PASS（独立审查 NEEDS_CHANGES 已全部关闭）**。P4 是既有 `first-version-system.architecture.json#1.1` 多目标目标架构的单目标子集，不修改主模型/DSL；Formal Gate 复核 Model、runtime DSL 与 Mermaid 渲染文档一致，既有 25 节点/33 关系均具有固定 Layer、`protocol`、`sync`，无 Runtime 回环，Storage 位于 Infrastructure，异步边视觉可区分。

## 独立审查关闭结论

1. **Active Activity cancel：PASS。** Workflow 为每个 Activity 创建 `CancellationScope`，配置 `WAIT_CANCELLATION_COMPLETED` 与 heartbeat timeout；cancel Signal 原子设置产品终态并取消 scope。Activity 通过 heartbeat 接收取消，将 AbortSignal 传播到 Agent execution，在提交前再次检查 cancellation，并把 claim 原子终结为 `cancelled`。真实测试故意让 Harness 忽略 Abort 并在确认 Agent 已收到取消后返回晚到成功；最终 ledger/result/checkpoint/artifact、projection、Workflow result 与 History 均保持 `cancelled`，History 同时含 Activity cancel requested/canceled，晚到结果未覆盖。
2. **`effect_unknown` retry：PASS。** 采用最小诚实方案，不实现 resolution protocol。`effect_unknown` 直接成为 Workflow result；controller 对 open/closed Workflow 分别通过 query 或 `describe + result` 读取权威状态，HTTP retry 返回稳定 409 `TASK_EFFECT_UNKNOWN_REQUIRES_RESOLUTION`。Workflow handler 也不接受 unknown retry；测试断言 Signal History 未增加、attempt/key/manualRetries 未变化、ledger references 仍为空。
3. **真实 Worker 接管：PASS。** Worker 1 的真实 Activity 已执行 Agent effect 并 durable commit 后，在 Activity 返回失败路径中 shutdown；Worker 2 以另一 Build ID 接管 retry。History 包含两个 Build ID 和 retry attempt≥2，durable claim≥2，ledger 仅一条 committed outcome，Agent effect 恰好一次。
4. **真实独立 PG 故障：PASS。** Task Store 使用独立 projection PG pool，经进程内 TCP 代理连接；测试关闭代理并销毁现有 socket，独立 probe 得到真实 `ECONNREFUSED`，未停止共享 Temporal PostgreSQL。故障期间 Temporal query、pause/resume control 和 Workflow completion 均成功，projection 为 `unavailable`；代理恢复后 outbox backfill=1，freshness=`fresh`。
5. **Controls：PASS。** pause、resume、retry、cancel 均逐项解码并断言 `sage.task.control.v1` History payload/controlId、即时 Workflow state 和最终 Workflow completed result；cancel 另断言 durable ledger/projection terminal 一致，unknown retry 另断言没有被写成已接受 Signal。
6. **证据纠正：PASS。** 原先仅在 slice 间停 Worker、布尔注入 projection outage、只统计 Signal 名称的证据已被上述真实 started/retry、TCP connection failure、Signal payload/terminal 断言替代。

## P4 边界结论

1. **确定性 Workflow：PASS。** `@sage/temporal-workflows` 生产源码只直接依赖 `@temporalio/workflow`，对 `@sage/task-domain` 仅使用可擦除类型；Workflow 只维护引用状态、Timer、Signal、CancellationScope 与 Retry。bundle/source/manifest 三重扫描拒绝 Agent Library/Client、Pi、PG/网络、Tool、Artifact/Secret/Credential Adapter 和 LLM SDK。真实 History 用故意改变 command 序列的 bundle replay，得到 `TMPRL1100 Nondeterminism`，证明负向 gate 有效。
2. **Activity/Agent 边界：PASS。** `agent-worker` 不导入 `agent-lib`/`harness-pi`，Agent Slice 只能调用注入的 `LocalAgentClient`；TypeBox 将每 slice 限为最多 4 turns、16 tool calls、32,000 tokens、30 秒。Temporal cancellation 经 Activity AbortSignal 传播给 Agent execution。
3. **Checkpoint 与副作用政策：PASS。** PG ledger 先以幂等键 claim；只有 Agent outcome 已知后，ledger 终态、checkpoint/artifact ref 与 projection outbox 才在同一事务提交。已提交 redelivery 直接返回 durable result，不重复 Agent effect。取消 claim 持久化为 `cancelled` 且不推进 references；未提交 lease 过期为 `effect_unknown`。unknown 未经显式 resolution 禁止 retry。
4. **产品投影 Owner：PASS。** Temporal History 是执行事实源。Task Store 是带 freshness 的可滞后投影；ledger+outbox commit 不依赖独立 projection PG pool 写成功，backfill 可补写。真实代理断连证明 Store projection 不可用时 Temporal 仍可 query/control/完成。
5. **Control 一致性：PASS。** create/query/signal/cancel/retry 固定到 `sage-dev` / `sage-agent-task-v1` / `sage.agent-task.v1`。合法 Control API 等待 Workflow query 观察到 controlId 后返回；closed Workflow 从 result 读取终态。真实测试逐项断言 Signal payload、terminal result 和 projection freshness。

## Architecture Score

| 维度 | 得分 | 依据 |
|---|---:|---|
| Layer | 15/15 | Task API、routing、Workflow/Activity、Agent、PG projection 分层明确 |
| DDD | 15/15 | Task contracts、execution、routing、projection owner 分离 |
| Dependency | 20/20 | ownership gate、source/dependency scan、bundle scan 均通过 |
| Scale | 6/10 | P4 明确只支持一个可信 Target/Queue；多目标是 P5 范围 |
| HA | 13/15 | active Worker takeover、Activity cancel/redelivery、真实 projection PG outage/backfill 已验证；本地 PG 仍单点 |
| Security | 9/10 | Workflow 无凭据/Secret I/O，History error 稳定化；生产 mTLS/RBAC 仍需目标环境验证 |
| Operation | 13/15 | Build ID、History replay、freshness、outbox repair 有证据；完整 reconciler 属 P6 |
| **总分** | **91/100** | Formal Gate PASS |

```yaml
status: pass
score: 91
rules:
  version: 1
  confidence: high
findings:
  - rule_id: temporal.worker-deployment-rollout-pending
    severity: low
    element_ids: [environment-task-workers, temporal-clusters]
    message: P4 使用精确 SDK 1.22.0 与 Build ID 作为兼容/重启证据，但 SDK 已将 buildId 标记 deprecated。
    action:
      target: model
      operation: update-attribute
      detail: 生产 rollout 前单独验证 Worker Deployment ramp/pinned/version compatibility；不得把 P4 Build ID 测试表述为生产 rollout 完成。
  - rule_id: state.full-history-reconciliation-deferred
    severity: low
    element_ids: [temporal-clusters, environment-task-workers, task-store]
    message: P4 outbox 可修复已提交 slice 投影，但跨全 History 的周期 reconciler 属 P6。
    action:
      target: model
      operation: update-attribute
      detail: P6 以固化 workflow_id/target 查询 History，修复缺失 control/terminal 投影并度量 lag。
  - rule_id: ha.local-postgres-single-point
    severity: low
    element_ids: [task-store]
    message: Compose PostgreSQL 为本地单节点，不能作为生产 HA 证据。
    action:
      target: model
      operation: update-attribute
      detail: 生产试运行前确定 PostgreSQL 副本、备份、RTO/RPO 与 outbox retention。
```

评审范围说明：主模型/DSL/渲染图 formal gate 使用 architecture-review 规则；P4 代码与运行态结论来自本次 `pnpm check`、P0 Temporal spike 和真实 Compose integration，不把图评审替代为实现证据。
