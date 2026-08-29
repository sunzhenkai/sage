# EffectLedger

`effect_ledger_entries` 表。一句:Sage 单一 authority,Run 期间每次外部副作用的不可变记录。

- 关键字段:`effect_id`、`run_id`、`envelope_id`、`kind`、`payload_ref`、`occurred_at`、`runtime_correlation`;
- 关系:N EffectLedger ↔ 1 AgentRun;N EffectLedger ↔ 1 Envelope;
- 读写:各 Store 包写入,Production Governance 审计读;
- 不变式:`effect_id` 唯一;`payload_ref` 是 ReferenceEnvelope(>8 KiB 必须引用,不允许内联);同一事务内 Effect 与状态变更一起提交;
- 失败态:Effect 失败必须先把 `state=failed` Effect 落库,再标记 Run 失败;
