# Schedule Plane

P8 引入的定时调度一等公民:一个 AI App Release 由 Schedule 驱动,7×24 无人值守定时运行。

## 定义

- **Canonical Schedule 契约**在 `platform-ports`(`ScheduleDefinition`/`ScheduleSnapshot`/`ScheduleControlStore`):cron/interval/timezone、misfire/catch-up 策略(`SKIP`/`CATCH_UP_ONE`)、overlap 并发策略(`SKIP`/`ALLOW`/`BUFFER_ONE`)、pause/resume、调度边界(targetConstraints);Temporal SDK 类型不进入 canonical 契约(`check-p8-boundaries` 强制)。
- **Temporal Schedules adapter** 独立成包 `temporal-schedules`,与 Coordinator 的隔离纪律一致;控制面由 agent-api 直连。
- **触发接线**:Temporal Schedule 的 target action 是确定性 dispatcher workflow(`ScheduleTriggerDispatcher.v1`)——纯计算 + 单次 activity 调用统一的包运行准入(`admitScheduleTrigger`),**不存在任何调度专属人工输入通道**。

## 容易混淆的近义

- **occurrence**:一次计划触发实例,幂等键 `schedule:{scheduleId}:occ:{occurrenceId}`(workflow ID = 幂等键);不是 Run 本身,一个 occurrence 经准入产生一个 Run(attempt)。
- **MISSED**:Temporal 不提供稳定的 missed 业务事件;对账 activity 按触发规则推算期望 occurrence 与已记录事件的差集补记,不是调度器原生状态。
- **FIXED vs FOLLOW**(releaseBinding):FIXED 创建时固化 Release digest,不漂移;FOLLOW 每次触发解析锚点 Release 的当前 active,不兼容(缺同名 task/params 不合法)时稳定失败并告警,**不静默跳过**。

## 出现在

- 实体 [Schedule 记录](../entities/schedule-record.md);处理线 [schedule-triggered-run](../flows/schedule-triggered-run.md);
- 模块 [task-domain](../modules/task-domain/README.md)(adapter)、[contracts-and-policy](../modules/contracts-and-policy/README.md)(canonical 契约)、[state-persistence](../modules/state-persistence/README.md)(控制面存储)、[apps](../modules/apps/README.md)(API/UI/dispatcher);
- 决策 `platform/docs/p8-decisions.md` D1–D5。

来源:`platform/packages/platform-ports/src/schedule.ts`、`platform/packages/temporal-schedules/src/*`、`platform/packages/agent-run-admission/src/schedule-trigger.ts`。
