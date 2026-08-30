# TaskProjection

`task_projections` 表。一句:外部看得到的 Temporal Task 状态镜像,UI 只读这一张表,不直读 Temporal。

- 关键字段:`task_id`、`tenant_id`、`task_type`、`state`、`workflow_id`、`namespace`、`task_queue`、`created_at`、`updated_at`;
- 关系:1 TaskProjection ↔ 1 Temporal Workflow(由 Worker Activity 持续 reconcile);
- 读写:agent-api 写创建/读查询,agent-worker 写状态、reconciler 校对;
- 不变式:`state` ∈ {`pending`, `running`, `succeeded`, `failed`, `cancelled`};`workflow_id` 不可改;
- 失败态:`failed` 携带 `error_code` 与 `error_message`,供 UI 展示;
