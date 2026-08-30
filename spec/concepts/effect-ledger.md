# Effect Ledger

Sage 的唯一 authority:每次 Run 的外部副作用(LLM 调用、Tool 调用、Artifact 写入、状态变更)都先写 Ledger 再落地。

- 为什么存在:让 Run 可重放、可对账、可追责;Ledger 是回放与计费的真相;
- 边界:写在 `effect_ledger_entries`;写入与对应状态变更在同一 Postgres 事务;
- 出现在:[data/INDEX.md](../data/INDEX.md)、[verify.md](../facets/verify.md)、模块 [state-persistence](../modules/state-persistence/README.md);
- 容易混淆:不是「日志」(日志是过程数据,可丢);Ledger 是账本,不可丢、不可改。
