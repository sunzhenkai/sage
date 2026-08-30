# Schedule 记录

P8。一个定时任务的持久化形态,落在 009 迁移的四张表(`agent_schedules`、`agent_schedule_trigger_events`、`agent_schedule_budget_accounts`、`agent_schedule_budget_accruals`),全部 FORCE RLS。

- **是什么**:一个绑定 `Release + Task + 固化 params` 的定时触发定义,由 [Schedule Plane](../concepts/schedule-plane.md) 驱动;
- **身份**:`(tenant_id, schedule_id)`;
- **关键字段**(`agent_schedules`):`snapshot`(控制面快照权威,JSON)、`revision`(≥1,乐观控制)、`state`(`ACTIVE`/`PAUSED`/`DELETED`)、`content_digest`(`sha256:*`)、`anchor_release_id`(FOLLOW 解析锚点)、创建/更新时间;
- **生命周期**:创建(校验绑定合法并登记 Temporal Schedule)→ ACTIVE ⇄ PAUSED → DELETE(停触发,历史保留);
- **触发事件**(`agent_schedule_trigger_events`,append-only):每次 occurrence 记 `SUCCEEDED`/`FAILED`/`SKIPPED`/`MISSED`,带 `occurred_at`、可选 `task_id`/`error_code`/`detail` 与 `event_digest`;UPDATE/DELETE 被 `sage_governance_immutable_guard()` 触发器拒绝;
- **预算**(`agent_schedule_budget_accounts` + `_accruals`):`limits` 声明上限、`window_ms` 滚动窗口;commit 同事务累加 `used`(accruals 幂等去重),超限 fail closed;
- **关系**:引用 [AgentPackageRelease 实体](agent-package-release-record.md)(FIXED 固化 digest / FOLLOW 锚点);每次成功触发产出 [AgentRun](agent-run.md)(新 attempt);账目挂 [ConsumptionLedger](consumption-ledger.md) 的 `schedule:<scheduleId>` accountRef;
- **谁读写**:`PostgresScheduleStore`(state-persistence)实现 [ScheduleControlStore](../modules/contracts-and-policy/README.md);agent-api 控制面与 dispatcher activities 读写;InMemory 实现在 local-fakes;
- **不变式**:快照 + revision + content_digest 三者一致才能被 `assertScheduleSnapshot` 接受;同一 `(schedule_id, occurrence_id, kind)` 事件唯一;触发历史的可见窗口上限 `SCHEDULE_TRIGGER_HISTORY_LIMIT_MAX = 200`;
- **常见错误状态**:FOLLOW 解析不兼容(缺 task/params 不合法)→ 该次触发 FAILED 并告警,不静默跳过;预算超限 → fail closed。

来源:`platform/packages/agent-state-postgres/migrations/009_p8_schedule_plane.sql`、`platform/packages/agent-state-postgres/src/schedule-store.ts`、`platform/packages/platform-ports/src/index.ts`。
