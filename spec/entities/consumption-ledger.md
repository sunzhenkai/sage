# ConsumptionLedger

`consumption_ledger_entries` 表。一句:Effect Ledger 的派生视图,按租户/容量/成本归集。

- 关键字段:`consumption_id`、`effect_id`、`tenant_id`、`meter`、`quantity`、`unit`、`occurred_at`;
- 关系:N ConsumptionLedger ↔ 1 EffectLedger(`effect_id` 唯一);
- 读写:派生任务读取 EffectLedger,写入 ConsumptionLedger;
- 不变式:`consumption_id` 唯一;`quantity ≥ 0`;不允许回写 EffectLedger;
- 失败态:派生失败需重试,不得直接修改 Effect;
