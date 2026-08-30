# Pilot Gate

P8 引入的无人值守定时 pilot 运行门:以证据裁决 GO/NO-GO,延续「未获得的生产证据保持 UNFILLED,不伪造」的诚实证据纪律。

## 定义

`production-governance/pilot-gate.ts` 的 `evaluatePilotGate` 引用五项证据:

1. 真实窗口 soak(14 天 / ≥100 次触发 / 故障自愈或稳定失败);
2. 告警路由(规则生成 + oncall roster);
3. 认证(service token 五链路强认证);
4. 风险台账(`platform/docs/p8-risk-ledger.md`,单点 Postgres 等风险显式接受);
5. 评审签名。

任一 UNFILLED → 输出 **NO-GO** 并列明补齐路径;关键前置回归即回到 NO-GO(决议不自动延续)。

## 配套

- 告警映射:`failure-taxonomy.ts` 单一映射表(稳定错误码 → 告警规则/runbook/响应路由),Prometheus 规则由表生成,未知错误码兜底;
- 重试预算护栏:`assertUnattendedRetryBudget`(task + schedule 双级)fail closed;
- 工程侧等效验证:`scripts/p8/soak.exercise.test.ts` 压缩时钟 soak(5 类故障注入,59 触发/86.4% 成功率/零静默重复),证据 `platform/evidence/p8/latest/soak-exercise.json`——它是**工程证据**,不能替代真实 14 天 soak 证据项。

## 容易混淆的近义

- **NO-GO ≠ 功能不可用**:功能已落地并可验证(压缩时钟演练通过);NO-GO 指的是「不允许无人值守上产」这一运行决策,补齐证据后重评。
- **风险台账 ≠ 隐瞒风险**:台账把已知风险(单点 Postgres 等)显式留档并接受,UNFILLED 项公开列出。

## 出现在

- 模块 [contracts-and-policy](../modules/contracts-and-policy/README.md)(实现)、[apps](../modules/apps/README.md)(接线);
- 处理线 [unattended-failure-resolution](../flows/unattended-failure-resolution.md);
- 决策 `platform/docs/p8-decisions.md` 运行门段;runbook `platform/docs/p8-incident-runbooks.md`。

来源:`platform/packages/production-governance/src/pilot-gate.ts`、`platform/packages/production-governance/src/failure-taxonomy.ts`。
