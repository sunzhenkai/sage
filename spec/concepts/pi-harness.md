# PiHarness

Sage 首版固定的 Agent Harness,由 `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` 提供,封装 LLM 调度、Tool 调用、Context 装配。

- 为什么存在:首版固定一个 Harness,避免在多 Harness 适配上分散精力;
- 边界:Harness 之上是 Agent Library,之下是 Model/Tool/Context Provider;
- 出现在:`docs/design/README.md` "Binding" 段、`platform/packages/harness-pi/`、模块 [agent-lib-runtime](../modules/agent-lib-runtime/README.md);
- 容易混淆:不是「Pi 数学常数」;Harness 是 Agent 与外部世界之间的胶水层。
