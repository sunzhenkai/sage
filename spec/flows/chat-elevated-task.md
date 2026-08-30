# Chat 长请求提升为 Temporal Task

## 背景

Chat 超过阈值(默认由 agent-api 判定,如 LLM 期望耗时或 Tool 数量),agent-api 把请求转给 Temporal,以便长时运行、可重试、可恢复。

## 目标

UI 拿到 Task Card,Workflow 在 Worker 中推进,状态变化实时反映到 [TaskProjection](../entities/task-projection.md)。

## 流程

1. agent-api 收到 `POST /v1/chat`,判定为长请求;
2. agent-api 写 [TaskProjection](../entities/task-projection.md) `state=pending`;
3. Task Router 按可信 TaskType、环境、能力、隔离、数据驻留选定 Temporal Cluster;
4. 启动 Workflow,`workflow_id` = `task_id`,Namespace/Task Queue 固定;
5. agent-worker 订阅 Task Queue,执行 Activity:
   - `runAgentActivity` 经 LocalAgentClient 调 Agent Library;
   - Activity 写 [Effect Ledger](../concepts/effect-ledger.md) 与 Checkpoint;
6. AgentRun 推进过程中,Activity 通过 Signal 把进度写回 TaskProjection;
7. UI 轮询 `GET /v1/tasks/:taskId` 拿到当前 TaskProjection。

## 依赖

- 上游数据:同 [chat-short-run](chat-short-run.md) + 提升策略配置;
- 服务:Postgres、Temporal Cluster(由 Task Router 选)、Agent Worker;
- 前置状态:Release `accepted`、Namespace 与 Task Queue 已声明。

## 输出

- Temporal Workflow 历史(由 Temporal 自动保留);
- TaskProjection 状态;
- Effect/Consumption Ledger 条目;
- AgentRun 与 Checkpoint。

## 失败

- Workflow 重试由 Temporal 策略决定(默认指数退避);
- Activity 不可重试错误 → Workflow `failed`,TaskProjection `state=failed`;
- 用户取消 → Signal Cancel → TaskProjection `state=cancelled`,Workflow 终止。
