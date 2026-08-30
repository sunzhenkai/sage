# AgentTaskSpec

一次 Agent Run 的可执行规格:目标 Release + 输入 + 执行参数(超时、重试、租户、Capability)。

- 为什么存在:把「Run 是什么」与「Run 怎么执行」分离,便于 Task Router 按 Spec 选择 Cluster/Worker;
- 边界:由 API 层从 Chat/Task 输入派生,落到 Temporal Workflow 输入;
- 出现在:[chat-elevated-task](../flows/chat-elevated-task.md)、模块 [task-domain](../modules/task-domain/README.md);
- 容易混淆:不是 TaskProjection;TaskProjection 是「外部看得到的 Task 状态」,Spec 是「Worker 执行的入参」。
