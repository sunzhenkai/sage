# Agent Library

单一可嵌入的 Agent Run 内核;Chat Service 与 Temporal Activity 都通过同一个 Library 执行 Agent Loop,不得在调用侧复制 Loop。

- 为什么存在:避免每个产品形态各自实现 Agent 循环,保证行为一致、可审计;
- 边界:对外只暴露 `LocalAgentClient` 风格 API 与 TypeBox 契约,内部细节由 `@sage/agent-lib` 收敛;
- 出现在:`docs/design/agent-library-mvp.md`、`docs/design/_cross/generic-agent-platform-final-architecture.md`、模块 [agent-lib-runtime](../modules/agent-lib-runtime/README.md);
- 容易混淆:不要与「Agent Application」混淆 — Application 是产品层,Library 是被嵌入的执行内核。
