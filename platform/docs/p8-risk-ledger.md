# P8 风险显式接受台账（unattended pilot）

pilot 依赖但尚未达到生产标准的风险项。台账记录每项风险的描述、影响、缓解、接受主体与复评期限；
存在未关闭的 UNFILLED 项时运行门输出 NO-GO。接受记录可追溯且不可静默清除。

| ID | 风险 | 影响 | 缓解 | 接受主体 | 复评期限 |
|----|------|------|------|----------|----------|
| p8-single-postgres | 单点 PostgreSQL | 调度控制面/账本不可用 → 触发失败（fail closed），不重复执行 | admission fail closed + 对账 MISSED 记录；数据每日备份 | UNFILLED — HUMAN INPUT REQUIRED | 2026-09-30 |
| p8-single-temporal | 调度设施单副本（compose 单 Temporal） | 调度服务不可用 → 触发窗口错过 → 对账补记 MISSED | 恢复后按 overlap/misfire 策略处理；不批量补偿 | UNFILLED — HUMAN INPUT REQUIRED | 2026-09-30 |
| p8-local-backup | 本地备份策略（未上生产级备份/恢复演练） | 数据丢失风险（控制面/账本/历史） | 迁移幂等 + append-only 审计；数据可重建自 EventLedger | UNFILLED — HUMAN INPUT REQUIRED | 2026-09-30 |

**门裁决规则**：台账存在未关闭 UNFILLED 项 → `evaluatePilotGate` 输出 NO-GO 并列出缺失项，不产生默认通过。
**真实 14 天 soak 证据**：保持 UNFILLED（见任务 7.6）；压缩时钟等效证据（`platform/evidence/p8/latest/soak-exercise.json`）仅为工程证据，不顶替真实窗口。
