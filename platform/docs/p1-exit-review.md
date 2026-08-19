# P1 退出评审

结论：**通过；同一 Agent Loop 可供 P2 状态、安全和观测能力消费。**

证据：

- `@sage/agent-contracts` 提供 v1 TypeBox schema、静态绑定、JSON round-trip、版本兼容和稳定错误测试。
- `@sage/agent-lib` 是唯一 budget/deadline/cancel/事件 sequence 仲裁循环；依赖边界禁止 Application、Temporal、Fastify、数据库和 UI。
- `@sage/harness-pi` 是唯一 Pi 直接依赖点，并提供启动前 capabilities 与显式 `skill://read-project-metadata/v1` 只读能力。
- `@sage/agent-client` 透明转发 event、cancel、Outcome 和 checkpoint ref。
- `@sage/node-host` 在无 HTTP、Temporal、数据库和 UI 的普通 Node.js 进程覆盖 success、failure、cancel、deadline、token/turn budget、pause 和 capability-missing。
- `corepack pnpm check` 与 `corepack pnpm --filter @sage/node-host start` 是可重现 gate。

已知边界：P1 checkpoint 仅为引用，持久化与敏感数据过滤由 P2 实现；真实模型 provider 不属于离线验收。
