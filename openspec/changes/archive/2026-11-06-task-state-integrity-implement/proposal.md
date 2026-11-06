# Proposal

## Why

Sage 的任务状态分散在 Temporal workflow、slice 账本（`task_effect_ledger`）和控制台读取的投影（`task_projection`）三处，三者当前没有统一的结算约定：瞬时失败会被 35 秒租约锁死并耗尽重试，手动 retry 会把账本里的失败结果当作成功返回，工作流走到部分终态时不写投影。结果是任务实际已失败，控制台却长期显示"运行中"（现网任务 `pkg-7cf31c31-fced-42d0-a183-ff7c2e6098d7` 已挂 12 天）。

## What Changes

- **重试换代**：手动 retry SHALL 以新的执行代次重跑失败 slice，不得复用账本中 `failed` 的结果；workflow 只把 `committed` 视为成功。
- **租约与重试窗口对齐**：slice claim 改为短 TTL + 心跳续租；首次投递丢失后，Temporal 重试能在租约过期后接管，不再以 `TASK_SLICE_ALREADY_IN_PROGRESS` 耗尽重试。
- **终态必落投影**：workflow 在返回任何终态（succeeded / failed / cancelled / effect_unknown）前 SHALL 写入投影，包括 `SLICE_LIMIT_EXHAUSTED` 与"取消先于提交"的竞态路径。
- **控制意图不被覆盖**：运行中 slice 完成后不得覆盖 `paused`；pause / cancel / retry 的工作流状态与投影保持一致。
- **不再伪造状态**：没有投影时不得把任务报告为普通 `running`；控制操作的前置校验不得依据伪造状态拒绝 retry。
- **自愈与清理**：接入投影 reconcile（从 Temporal 历史重建）+ 残留 `claimed` 账本清理；`GET /v1/tasks/:id` 与 `controller.query` 使用同一权威判定。
- **测试补齐**：覆盖可重试失败、失败后手动重试、pause 竞态、上限耗尽、取消/提交竞态、无投影查询。

## Capabilities

### New Capabilities

- `task-state-integrity`: 任务状态在 workflow、slice 账本与投影之间的一致性契约，包括 claim 租约、手动重试换代、终态结算、控制意图和投影重建。

### Modified Capabilities

（无。`app-release-management` 描述的是 App/Release 生命周期，不涉及任务执行状态机。）

## Impact

- `platform/apps/agent-worker/src/activities.ts`：claim/租约/心跳、失败分类与结果结算。
- `platform/packages/temporal-workflows/src/workflows.ts`：状态迁移、retry 换代、终态投影。
- `platform/packages/task-store-postgres/src/index.ts`：账本代次与租约续期、投影写入守卫、无投影视图、清理与重建。
- `platform/packages/temporal-routing/src/index.ts`：控制后的投影回写、reconcile 与查询口径。
- `platform/apps/agent-api/src/task-api.ts`：控制前置校验与查询路径。
- `platform/packages/task-domain/`：类型与迁移（账本 `generation` 列）；`platform/apps/agent-worker/src/*test.ts`、`platform/examples/workflow-durability-integration/`：回归测试。
- 不改动对外 HTTP 契约的形状；错误码沿用现有 `TASK_CONTROL_NOT_APPLICABLE` 等。
