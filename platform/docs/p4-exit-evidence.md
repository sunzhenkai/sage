# P4 单目标 Temporal Task 退出证据

日期：2026-08-12  
状态：**PASS；P4 独立审查 NEEDS_CHANGES 全部关闭；未提交、未归档。**

## 交付边界

- `@sage/task-domain`：TypeBox v1 TaskType/lifecycle/stable refs/slice bounds/control/query/projection/Store ports；ledger 支持 durable `cancelled` terminal。
- `@sage/task-store-postgres`：PG migration、原子 claim、commit/effect_unknown/cancelled、幂等 redelivery、primary ledger/outbox 与独立 projection pool、outbox backfill。
- `@sage/temporal-workflows`：单 Target `AgentTaskWorkflow`，只含 refs/state、Timer、Signal、CancellationScope、Activity Retry；active cancel 使用 `WAIT_CANCELLATION_COMPLETED`，unknown effect 不接受 retry。
- `@sage/agent-worker`：Activity 仅经 `LocalAgentClient` 执行 bounded Agent Slice；heartbeat 接收 Temporal cancel 并传播 AbortSignal；checkpoint/artifact 只在明确 commit boundary 推进。
- `@sage/temporal-routing` + `agent-api`：create/query/signal/cancel/retry API；closed Workflow 通过 `describe + result` 读取 History terminal；unknown retry 返回 409。
- `examples/p4-integration`：真实 Temporal+PG、active Worker shutdown/retry takeover、post-commit redelivery、真实 TCP PG outage/backfill、active cancellation late result、unknown retry rejection、controls/History、负向 nondeterminism replay。

## 可重现 gates

```bash
cd platform
corepack pnpm test:p4:integration
corepack pnpm spike:temporal:integration
corepack pnpm check
cd ..
openspec validate sage-p4-single-target-temporal-task --strict
```

## 已取得证据

1. **P0 Temporal spike：PASS。** `corepack pnpm spike:temporal:integration` 返回 `namespace=sage-dev`、Build ID `sage-p0-build-1`、`historyEvents=13`、`replay=passed`。
2. **全仓质量：PASS。** `corepack pnpm check` 完成 ESLint、ownership/dependency checks、P4 boundary scan、strict TypeScript、63 passed/12 skipped 普通测试和所有 package/Vite builds；边界输出包含 `P4 Workflow bundle/source/dependency boundaries: OK`。
3. **真实 P4 integration：PASS 6/6。** `corepack pnpm test:p4:integration` 连接 Compose `temporalio/auto-setup:1.29.1` 与 `postgres:17.6-alpine`：
   - Worker 1 的 Activity 已执行 effect 并 durable commit 后 shutdown，Worker 2 接管 retry；History 含 `sage-p4-worker-active-1`/`sage-p4-worker-active-2` 和 attempt≥2，durable claim≥2，Agent effect=1，ledger outcome=committed；
   - post-commit failure redelivery 不重复 Agent effect；错误 bundle replay 明确产生 `TMPRL1100 Nondeterminism`；
   - 独立 projection PG pool 经 TCP proxy；断开后 Task Store 失败且独立 probe 为真实 `ECONNREFUSED`，共享 Temporal PG 未停止；Temporal pause/resume/query/completion 继续，恢复后 `backfillProjection()=1` 且 freshness=`fresh`；
   - `effect_unknown` 完成后 HTTP retry 返回 409 `TASK_EFFECT_UNKNOWN_REQUIRES_RESOLUTION`，History Signal 数不增加，manualRetries/attempt/key 不变，checkpoint/artifact 均为 `NULL`；
   - active Activity cancel 等到 Agent AbortSignal 已到达，再故意释放晚到成功；ledger/result/checkpoint/artifact、projection、Workflow terminal 均保持 cancelled，History 有 Signal、Activity cancel requested/canceled 与 Workflow completed result；
   - pause、resume、retry、cancel 逐项断言 Signal payload/controlId、Workflow state 与 terminal History；retry 终态 succeeded，pause/resume 任务终态 succeeded，cancel 终态 cancelled。
4. **架构评审：PASS 91/100。** 见 `docs/p4-architecture-review.md`；独立审查六项关闭，剩余 finding 均为 P5/P6/生产 rollout 或本地 PG HA 的低风险后续项。
5. **OpenSpec：PASS。** tasks 已按真实证据改写，未以原先 slice 间重启、布尔 projection outage 或仅 Signal 名称统计冒充完成；strict validate 作为最终 gate 执行。

## Ownership 与限制

- Temporal History 是执行事实源；Task Store ledger/outbox 是 durable side-effect boundary，projection 是可滞后、可补写的产品视图。
- Cancel 是写入 History 的 control Signal，并真实取消 active Activity；Activity cancellation acknowledgement 前 Workflow 不应用 Activity completion，提交前也再次检查 cancellation。
- `effect_unknown` 在 P4 没有 resolution protocol，因此不可 retry；未来若支持 resolution，必须新增可审计 resolution、attempt 与 idempotency key。
- P4 只证明一个可信 dev Target，不证明多 Target 路由、跨 Cluster 迁移、生产 Worker Deployment rollout、生产 PostgreSQL HA 或完整 P6 History reconciler。
- Compose 容器保持运行供本地复验；没有创建 commit，也没有 archive OpenSpec change。
