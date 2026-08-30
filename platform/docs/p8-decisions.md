# P8 决策记录（unattended schedule pilot）

## D1 契约落点
Canonical Schedule 契约在 `platform-ports`（与 Coordinator 同层）；HTTP 契约在 `app-contracts`（自包含 wire schema，依赖边界为空，与 canonical 语义一致性由 `schedules-api` 一致性锚定）。

## D2 Adapter 独立成包
`temporal-schedules` 独立于 `temporal-routing`/`temporal-registry`（隔离纪律与 `temporal-workflows` 之于 Coordinator 一致）。canonical 契约不泄漏 Temporal 类型（`check-p8-boundaries` 强制）。

## D3 触发接线
Temporal Schedule 的 target action 是确定性 dispatcher workflow（`ScheduleTriggerDispatcher.v1`）：纯计算 + 单次 activity 调用既有包运行准入（`package-run-input-resolution` 语义），occurrence 幂等键 `schedule:{scheduleId}:occ:{occurrenceId}`（workflow ID = 幂等键；admission 幂等键含 task + 固化 params；task store 唯一约束）。

## D4 missed/skipped 对账
Temporal Schedules 不提供稳定的 missed 业务事件；对账 activity 按触发规则推算期望 occurrence 与已记录事件差集（interval 网格锚定 createdAt；cron 由设施侧 numActionsMissedCatchupWindow 计数辅助）。

## D5 Release 绑定
FIXED：创建时固化 digest（resolved digest ≠ pinned 即稳定失败，不漂移）。FOLLOW：每次触发 admission 时解析锚点 Release 的当前 active（锚点由控制面 `agent_schedules.anchor_release_id` 记录）；不兼容即稳定失败告警，不静默跳过。

## D6 EFFECT_UNKNOWN 裁决
不复活终态（authority 矩阵不破）；裁决落 append-only `agent_effect_resolutions`（既有服务），动作映射由 `/v1/effects/resolutions`（未提交+继续 → 新 attempt 经 retry；已提交+继续 → Ledger replay 幂等；终止 → cancel）。

## D7 认证
pilot 链路静态 service token（`SAGE_SERVICE_TOKEN_HASHES`，哈希 + 常量时间比较 + 可轮换）；配置生效时 stub 信任头在 packages/apps/runs/schedules/resolutions 五条链路停止提权。本地开发用 `SAGE_SERVICE_TOKEN` 注入 dev token（见 compose）。

本地 dev token 配置（Schedule 管理 UI 可用的前置；浏览器不持有凭据，由 agent-web 同源代理在服务端为 `/v1` 管理请求注入 `Authorization: Bearer`）：

```bash
cd platform
TOKEN=$(openssl rand -hex 32)
printf 'SAGE_SERVICE_TOKEN=%s\nSAGE_SERVICE_TOKEN_HASHES=%s\n' "$TOKEN" "$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)" >> .env
```

未配置时 schedules 管理链路对所有请求 fail closed（401），agent-web 不注入任何凭据，Schedule UI 显示未认证错误态（不回退 stub 信任头，与运行门一致）。

## D8 schedule 预算账户
Ledger 内新聚合维度：schedule 触发的 run 以 `schedule:<scheduleId>` 为 accountRef（余额即声明上限），reserve 天然执行跨 run 聚合硬上限；`agent_schedule_budget_accounts` 记录窗口与累加（commit 同事务累加 `agent_schedule_budget_accruals`）；窗口滚动由 check 触发重置。

## D9 soak 双轨
`scripts/p8/soak.exercise.test.ts` 以确定性 fakes + 压缩时钟跑等效窗口（5 类故障注入），输出 `platform/evidence/p8/latest/soak-exercise.json`（工程证据）；真实 14 天 soak 证据项保持 UNFILLED（运行门裁决）。

## D10 失败告警映射
`production-governance/failure-taxonomy.ts` 单一映射表（稳定错误码 → 告警规则/runbook/响应路由）；`sage-p8-alerts.yaml` 由该表生成（每条规则强制 responder_service 与 runbook_url 注解）；未知错误码兜底告警。

## 运行门
`production-governance/pilot-gate.ts` 的 `evaluatePilotGate` 引用五项证据（真实窗口 soak、告警路由、认证、风险台账、评审签名）；任一 UNFILLED 输出 NO-GO 并列明补齐路径；关键前置回归即回到 NO-GO（决议不自动延续）。
