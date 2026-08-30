# Schedule 定时触发运行

P8 主处理线:一个已准入的 AI App Release 由 Schedule 定时驱动,无人值守产生 durable Run;全程零静默重复、每次触发可审计。正常人工/Chat 触发见 [chat-short-run](chat-short-run.md) 与 [chat-elevated-task](chat-elevated-task.md)。

## 背景

无人值守场景下没有人在场提交输入;触发器的输入来源由 [App Manifest v2](../concepts/app-manifest-v2.md) 消解——schedule 绑定 `releaseRef + task + 固化 params + releasePolicy(pinned|follow)`,创建时按当时 Release 校验绑定合法性。

## 目标

每次计划触发(occurrence)恰好产生一个 Run(attempt);失败要么自愈、要么稳定失败并告警到人(见 [unattended-failure-resolution](unattended-failure-resolution.md)),不静默跳过。

## 流程

1. **创建**:用户经 agent-web [Schedules 视图](../modules/apps/README.md) 或 `POST /v1/schedules` 提交定义;`registerSchedulesRoutes` 校验 wire 契约(`ApiSchedule*.v1`)、releaseBinding 合法性与预算,写审计,经 `TemporalScheduleAdapter` 登记原生 Temporal Schedule,控制面快照落 `agent_schedules`(`PostgresScheduleStore`);
2. **到期触发**:Temporal Schedule 按 cron/interval 启动 dispatcher workflow `ScheduleTriggerDispatcher.v1`(task queue `sage-schedule-dispatcher-v1`);occurrence 幂等键 `schedule:{scheduleId}:occ:{occurrenceId}` 即 workflow ID——重放/重复投递不会产生第二个 Run;
3. **触发准入**:dispatcher 调 activity(见 [apps/agent-worker](../modules/apps/README.md))执行 `admitScheduleTrigger`——解析 releaseBinding(FIXED 校验 digest 不漂移;FOLLOW 解析锚点 Release 当前 active)、按 inputs 声明固化 params、经受控出口抓取 dataSources 快照(`onFailure` 语义)、reserve schedule 预算;产出 `AgentTaskSpec` 与新 attempt,进入既有 durable coordinator;
4. **执行与记账**:Run 在 [task-domain](../modules/task-domain/README.md) workflow 内推进,输出在物化点按 `run_contract` 强制(见 [output-contract](../modules/apps/README.md));Effect 记账挂 `schedule:<scheduleId>` accountRef,commit 同事务累加预算;
5. **回写**:触发事件(成功/失败/跳过)append-only 落 `agent_schedule_trigger_events`;`recordScheduleTriggerSignal` 记 `sage_schedule_trigger_total`(低基数);UI 触发历史 `GET /v1/schedules/:id/triggers` 可见;
6. **对账**:对账 activity 按触发规则推算期望 occurrence 与已记录事件差集,补记 `MISSED`。

## 依赖

- Temporal Schedules 能力(服务端 1.29.1 已支持);
- Postgres(009 四张表,RLS 隔离);
- 上游 Release 已 `accepted`(见 [release-admission](release-admission.md))。

## 输出

- durable Run(attempt)+ TaskProjection 可见;
- append-only 触发事件与预算累加;
- `sage_schedule_trigger_total` 指标与日志。

## 失败

- FOLLOW 解析不兼容(新 Release 缺同名 task/params 不合法)→ 该次触发稳定失败并告警,不静默跳过;
- 预算超限 / 重试预算耗尽 → fail closed(无部分副作用残留),按 [failure-taxonomy](../concepts/pilot-gate.md) 路由告警;
- dispatcher/worker 崩溃 → Temporal 重试 + 对账收敛,幂等键保证零静默重复;
- 管理操作(pause/resume/delete)随时止血,已产生 Run 不受影响。

时序图:[diagrams/schedule-trigger-run-sequence.html](../diagrams/schedule-trigger-run-sequence.html)。
