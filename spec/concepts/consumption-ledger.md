# Consumption Ledger

Effect Ledger 的派生视图:把 Effect 按租户、容量、成本归集,服务于配额与计费。

- 为什么存在:让 Effect 在 Ledger 中保留原始粒度,又在 Consumption 中按业务口径聚合;
- 边界:消费数据来自 Effect,不写回 Ledger;违反这个顺序即视为破坏单一 authority;
- 出现在:[Effect Ledger](effect-ledger.md)、模块 [state-persistence](../modules/state-persistence/README.md);
- 容易混淆:不是「账单」(账单由外部系统消费 Consumption Ledger 生成);Consumption Ledger 是账本。
