# Task Router

Temporal Cluster 选择策略器:根据可信 TaskType、环境、能力、隔离、数据驻留规则,把 Workflow 投递到目标 Cluster。

- 为什么存在:多环境/多区域部署时,Task 不能「自己挑 Cluster」;Router 是唯一决策点;
- 边界:Router 决策后,Workflow 启动信息固定 Cluster/Namespace/Task Queue,不静默跨实例迁移;
- 出现在:[chat-elevated-task](../flows/chat-elevated-task.md)、模块 [task-domain](../modules/task-domain/README.md);
- 容易混淆:不是 Worker 内部的负载均衡;Worker 内的负载由 Temporal 调度。
