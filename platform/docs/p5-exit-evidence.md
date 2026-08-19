# P5 可信多目标 Temporal Routing 退出证据

日期：2026-08-12  
状态：**PASS；14/14 tasks 完成。未提交、未归档、未 push。**

## 交付与阻断项关闭

- `@sage/temporal-registry`：版本化 TaskType/TargetProfile/Policy/Bundle schema；固定 registryId；受信任 authorizer 验证 approver identity/role；服务端生成 approvalId/approvedAt；Owner/职责分离/publication/rollback/append-only audit；跨 publication artifact catalog 拒绝同 `(id,version)` payload/credential mutation。
- `@sage/temporal-routing`：strict trusted input、TaskType residency 与 target 约束过滤、health/capacity/backlog/priority/fallback 解释、`ROUTING_UNAVAILABLE`；Client cache 绑定全部 client-relevant snapshot 字段。
- start 协议：reservation 原子持久化不可变 snapshot、decision 和完整 `WorkflowStartEnvelope`。ACK 丢失、transport/describe/store 写失败，以及 Client Factory 的 credential provider/connector 瞬时失败，均保持 `start_pending` 并返回稳定脱敏可重试的 `WORKFLOW_START_OUTCOME_UNKNOWN`；下一次 create/reconcile 只按原 snapshot/envelope/workflowId 恢复。只有明确 start rejection + authoritative not-found 才写 `target_unavailable`。并发 create/reconcile 由固定 workflowId 幂等，不跨 Cluster duplicate。
- `WorkflowTargetSnapshot.v1` 包含 `isolationKey`；PG 同时保存 snapshot/envelope，trigger 禁止二者变更；create/query/signal/cancel/retry 均 snapshot-bound。
- credential：Factory 接管并清零 provider 原 lease buffer，不保留 connector/provider cause；API 仅返回稳定脱敏 code。默认 Temporal SDK 的不可清零 JavaScript apiKey string 内存限制已记录。
- 两个 TaskType、两个 dev Target/Task Queue 与真实 Temporal/PostgreSQL integration 均保留；P4 SingleTarget 语义回归通过。

## 对抗性测试

- credential provider first-fail-then-recover 与 connector first-fail-then-recover：首次错误稳定脱敏且 reservation 保持 `start_pending`；Registry 切换后仍用原 snapshot/envelope/workflow/target 恢复，原 target 恰好一个 Workflow，另一 target start=0，credential lease 清零且无 secret 泄漏。
- Task create HTTP 对抗矩阵：顶层与 nested `slice` 的未知字段，以及 raw-target 同义字段的大小写/下划线/连字符变体，全部在 controller 前返回 `400 TARGET_OVERRIDE_REJECTED`；合法完整 body 保持不变并正常进入 controller。
- accepted start + ACK lost + 首次 describe transient：最终 `started`，仅一个 Workflow。
- `markWorkflowStarted` 连续失败：durable 状态保持 `start_pending`，从持久化 envelope 恢复；不同 inputRef 重试被 `TASK_CREATE_CONFLICT` 拒绝；control 恢复。
- 并发 create/reconcile：同 snapshot、同 input、恰好一个 accepted Workflow、无 fallback/duplicate。
- 完整 snapshot schema/isolationKey 与 PG tamper trigger；TaskType residency rationale。
- 未认证/伪造 human approval、owner 自批、空 reason、同版本 target/credential mutation、registryId drift 均拒绝。
- credential provider 保留 lease alias、connector 抛 secret-bearing error：lease 清零，error/cause/serialization/API body 不含 secret。
- publication/rollback：旧 route decision/snapshot 保留，新 Task 使用 active version。

## 命令证据

- `corepack pnpm install --frozen-lockfile`：PASS；24 workspace projects；`Lockfile is up to date`；435ms。
- 本次 P5 缺陷定向测试：PASS；3 files / 20 tests（temporal-routing controller/factory + Task create HTTP 对抗矩阵）。provider 与 connector first-fail-then-recover 均覆盖 immutable recovery、single Workflow/no fallback 和 secret redaction/zeroing。
- `corepack pnpm check`：PASS；lint、dependency/chat/P4/P5 boundaries、strict TypeScript；18 files passed、1 skipped，87 passed、12 skipped；23/24 workspace builds PASS。
- `corepack pnpm test:p5:integration`：PASS；1/1，931ms；真实 `sage-agent-task-us-v1` / `sage-agent-task-eu-v1`，双 TaskType/Target，PG envelope/snapshot/isolationKey 和 immutable trigger 通过。
- `corepack pnpm test:p4:integration`：PASS；1 file / 6 tests，13.55s；Worker takeover、redelivery/nondeterminism、PG outage/backfill、effect_unknown、active cancel、controls 全部保持。
- `openspec validate sage-p5-trusted-multi-target-temporal-routing --strict`：PASS；`Change 'sage-p5-trusted-multi-target-temporal-routing' is valid`。
- `tasks.md`：14 个 `[x]`，0 个未完成。

## 审批声明

`docs/p5-control-plane-review.md` 是 AI 按 Owner 视角完成的技术 review，**不是人类批准**。dev authorizer/approver 名称只验证认证与状态机；不代表真实个人、生产授权或 production publication 批准。
