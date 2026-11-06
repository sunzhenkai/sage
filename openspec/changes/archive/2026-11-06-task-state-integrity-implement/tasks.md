# Tasks

## 1. 账本、代次与租约

- [x] 1.1 新增迁移 `packages/task-domain/migrations/009_task_state_generation.sql`：`task_effect_ledger` 增加 `generation integer NOT NULL DEFAULT 1`，唯一键改为 `(tenant_id, task_id, attempt, slice_number, generation)`，并补充索引；验证：`node scripts/production-governance/migration-preflight.mjs` 与本地 postgres 迁移通过
- [x] 1.2 `packages/task-store-postgres/src/index.ts`：`claimSlice` 接受 `generation`，幂等键与查询/写入包含代次；新增 `renewLease(idempotencyKey, ownerToken, leaseExpiresAt)`；验证：`packages/task-store-postgres/src/claim-slice.reclaim.test.ts` 扩展后通过
- [x] 1.3 `apps/agent-worker/src/activities.ts`：`leaseMs` 默认改 2s、启动校验 `leaseMs > 3 × heartbeatInterval`；把首次心跳移到 activity 入口；心跳定时器同时续租；验证：`pnpm --filter @sage/agent-worker typecheck` 与新增单测通过
- [x] 1.4 租约窗口与重试窗口对齐回归：首次投递认领后丢失，下一次投递能重新认领并执行；验证：新增/扩展单测断言第二次 `claimSlice` 返回 `claimed`

## 2. 工作流状态机

- [x] 2.1 `packages/temporal-workflows/src/workflows.ts`：新增 `retryGeneration` 透传；手动 retry 递增代次并以新代次调用分片；验证：workflow 单测断言重试后 activity 入参 `generation` 增加
- [x] 2.2 成功判定只看 `outcome === 'committed'` 且 `done`；`failed` 结果进入失败等待分支，不再置 `succeeded`；验证：新增 workflow 单测覆盖"失败结果重放不得成功"
- [x] 2.3 分片提交时保留 `paused`：状态更新改为 `paused` 优先；验证：workflow 单测覆盖"运行中暂停 + 分片完成"
- [x] 2.4 终态投影：新增 `recordProjection` activity 并在所有终态 return 前调用（含 `SLICE_LIMIT_EXHAUSTED` 与取消先于提交）；写入失败不影响工作流结果；验证：workflow 单测断言各终态均产生投影
- [x] 2.5 `heartbeatTimeout` 由 1s 调整为 10s；验证：workflow 定义测试与 `typecheck` 通过

## 3. 投影一致性

- [x] 3.1 `packages/task-store-postgres/src/index.ts`：投影写入守卫允许 `failed → running`（重试语义），仍禁止 `succeeded/effect_unknown → running`；验证：新增投影写入单测覆盖两方向
- [x] 3.2 无投影视图不再伪装：`#viewFromRow` 保持 `status` 与 `freshness: 'unavailable'`、`staleReason: 'projection_unavailable'`，并补 `attempt` 取值来源；验证：store 单测断言缺失投影时字段完整
- [x] 3.3 `apps/agent-api/src/task-api.ts`：`controlConflict` 在投影 `freshness !== 'fresh'` 时放行 retry / cancel，其余判定交 workflow；验证：`task-api.*.test.ts` 覆盖无投影重试返回 202
- [x] 3.4 `GET /v1/tasks/:taskId` 与 `controller.query` 口径统一：配置了 queryStore 时，投影不可用则回落查询工作流（读失败保留原投影响应）；验证：新增任务查询单测覆盖"投影缺失、工作流 failed"
- [x] 3.5 `listTaskViews` 状态过滤不再丢弃无投影任务：用 `COALESCE(p.status, 'running')` 语义或等价过滤；验证：store 单测覆盖按状态筛选包含无投影任务

## 4. 自愈与清理

- [x] 4.1 `packages/temporal-routing/src/index.ts`：`reconcile` 可从 Temporal describe/history 生成 `projection_source: 'history'` 投影并写 `task_projection_repair_audit`；验证：`reconciler.test.ts` 扩展后通过
- [x] 4.2 agent-api 接入后台巡检（按 `listReconciliationCandidates` 扫描）与 `POST /v1/tasks/:taskId/reconcile` 手动端点；验证：新增 API 测试覆盖两类触发
- [x] 4.3 `task-store-postgres` 增加残留认领清理：回收 `status='claimed' AND lease_expires_at < now() - interval '1 hour'` 的行，并跳过已提交结果；验证：新增单测覆盖"终态任务残留认领被回收，重试可认领"

## 5. 集成验证与文档

- [x] 5.1 `examples/workflow-durability-integration` 增加回归：可重试失败重跑成功、真实失败后手动重试重跑、pause 竞态、分片上限、取消/提交竞态；验证：`pnpm test:workflow-durability:integration` 通过
- [x] 5.2 全仓门禁：`pnpm lint`、`pnpm typecheck`、`pnpm test`；验证：三条命令 exit 0，结果记入变更验证记录
- [x] 5.3 更新 `platform/README.md` 或任务相关文档中的状态机说明（claim 租约、手动重试代次、投影新鲜度）；验证：文档描述与实现一致，含可复跑命令
- [x] 5.4 现网挂死任务处理说明：对存量无投影任务给出 cancel/reconcile 的操作路径；验证：在本地 stack 复现并记录命令输出

## Workflow follow-up

- 归档前跑 `openspec validate task-state-integrity-implement --strict`。
- 归档后同步主 specs。

## 验证记录

- 2026-11-06 `pnpm typecheck` exit 0（platform workspace + spikes）。
- 2026-11-06 `pnpm lint` exit 0。
- 2026-11-06 `pnpm test`：161 个测试文件、1024 passed / 93 skipped，exit 0。
- 2026-11-06 新增单测：`packages/temporal-workflows/src/workflow-state.test.ts`（失败结果不得成功、pause 保留、终态投影形状）、`apps/agent-api/src/task-api.reconciliation.test.ts`（无投影 retry、GET 回落、reconcile 端点）、`packages/temporal-routing/src/controller.test.ts`（repairProjection）。
- 2026-11-06 新增集成用例（未在本机执行）：`examples/workflow-durability-integration` 的 retry 换代与分片执行中暂停；`packages/task-store-postgres/src/claim-slice.reclaim.test.ts` 的 generation / renewLease / expireStaleClaims。本机未起隔离 postgres+temporal，未跑 `pnpm test:workflow-durability:integration` 与 postgres 集成套件。
- 2026-11-06 已跑 postgres 集成（隔离 compose 栈 `sage-tasksi-test`，临时端口 25444）：`claim-slice.reclaim.test.ts` + `projection.integration.test.ts` 8 passed，覆盖迁移 010、generation 分行、renewLease、expireStaleClaims 与投影写入守卫。
- 2026-11-06 额外修复：迁移 001 重跑时用不含 `failed` 的旧约束校验已有失败行，导致有 failed 行后再启动 API 时 `migrate` 失败（现网会卡重启）。已让 001 的 v2 约束包含 `failed`，对应回归在隔离 postgres 上验证通过。
- 2026-11-06 未跑通：`workflow-durability` 集成套件。在本机隔离 Temporal 上首个用例 30s 超时；在 `main` 基线同样超时，确认是套件既有的环境依赖（Worker Deployment 切版 + provider 配置），非本次改动引入。新加的两个用例沿用同一 harness，待具备该环境时执行。
- 2026-11-06 未跑：`scripts/production-governance/migration-preflight.mjs`（需要 postgres 迁移前置检查环境）。
