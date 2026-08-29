# AgentRun

`agent_runs` 表。一句:Agent Library 内部一次 Run 的状态,由 `LocalAgentClient` 推进。

- 关键字段:`run_id`、`session_id` 或 `task_id`、`release_id`、`state`、`runtime_correlation`、`created_at`、`updated_at`;
- 关系:AgentRun ↔ N EffectLedger(可重放)、↔ N Checkpoint;
- 读写:agent-state-postgres(读写),LocalAgentClient 落库;
- 不变式:`run_id` 全局唯一;`release_id` 不可改;`state` ∈ {`queued`, `running`, `awaiting_input`, `succeeded`, `failed`, `cancelled`};
- 失败态:失败时 Effect Ledger 已落,`state=failed` 由 Resume/Fence 决定能否续跑;
