# AgentExecutionEnvelope

Run 的运行时容器:Context + RuntimeCorrelation(env/tenant/trace) + Capability 集合 + ReferenceEnvelope。

- 为什么存在:让所有 Run 副作用都可被 Effect Ledger 关联回 Envelope,从而支持重放、对账、计费;
- 边界:由 `@sage/platform-ports` 定义 TypeBox,各 Store 包落库;ReferenceEnvelope 强制不内联大对象(>8 KiB);
- 出现在:[Effect Ledger](effect-ledger.md)、[Consumption Ledger](consumption-ledger.md)、模块 [state-persistence](../modules/state-persistence/README.md);
- 容易混淆:不是 AgentTaskSpec;Spec 是入参,Envelope 是运行容器。
