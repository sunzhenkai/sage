# 设计：AI App 无人值守定时运行 Pilot

## Context

AI App 运行链路已交付（`agent-package-release → agent-release-registry → agent-run-admission → DurableCoordinatorWorkflow.v2`，见 `ai-app-lifecycle-e2e` spec 与 7a8df3a）；durable 侧有成熟的可复用资产：不可变 TargetSnapshot、`EFFECT_UNKNOWN` 终态与告警、Consumption Ledger 的 reservation/commit/release、Worker Build-ID 版本化与 replay gate、P7 的 exercise-suite 验证惯例。缺口（见 proposal）：无定时入口、无裁决出口、无跨 run 预算、pilot 链路认证是明文信任头 stub（`apps-api.ts` 的 `x-authentication-id` 回退）。

约束：canonical 契约不泄漏调度设施类型（与 `durable-agent-coordination` 同一纪律）；Temporal Workflow 内禁 I/O；诚实证据纪律（P7 先例：缺失的人类证据保持 UNFILLED）。

## Goals / Non-Goals

**Goals:**

- Schedule 作为一等公民接入既有 admission→coordinator 链路，不改 Coordinator 语义
- `EFFECT_UNKNOWN` 有可审计的裁决出口；无人值守失败全类别可告警可路由
- schedule 级聚合预算护栏；pilot 链路 service token 认证
- soak harness 支持压缩时钟自动化等效验证 + 真实窗口证据项（UNFILLED 纪律）

**Non-Goals:**

- 跨 Cluster/Target 显式迁移、第二个 Engine Adapter、Webhook/事件触发、Multi-Agent、真实 billing、完整 HA（均推 M+1）
- 通用 cron 服务或 BPM；schedule 仅服务 AI App/Agent Task 触发
- OIDC 完整身份体系（首版静态 service token，OIDC 留后续）

## Decisions

### D1. 契约落点：`platform-ports` + `app-contracts`

Canonical Schedule 契约（`ScheduleDefinition`、`ScheduleOccurrence`、`ScheduleTriggerEvent`、`SchedulePort`）放 `platform-ports`，与 Coordinator 契约同层；HTTP schema 放 `app-contracts`。备选：放 `task-domain`——拒绝，因为 schedule 是触发面概念，不是 task 产品状态；`agent-contracts` 只放运行时 Spec/Envelope，不承载控制面调度概念。

### D2. Adapter 独立成包：`temporal-schedules`

新建 `platform/packages/temporal-schedules`，依赖 `platform-ports` + Temporal SDK，实现 `SchedulePort`（create/pause/resume/delete/upsert/backfill 关闭）+ occurrence dispatcher workflow + 状态对账 activity。备选：并入 `temporal-routing`——拒绝，路由包职责是 target registry/router；独立包使 conformance 边界扫描（canonical 不含 Temporal 类型）与 fake adapter 替换有明确物理边界（先例：`temporal-workflows` 之于 Coordinator）。

### D3. 触发接线：dispatcher workflow + occurrence 幂等键

Temporal Schedule 的 target action 是一个**确定性 dispatcher workflow**（`ScheduleTriggerDispatcher.v1`，输入 scheduleId + occurrenceId + schedule snapshot ref），它只做一件事：调用控制面 activity 执行 admission（失败按 retry policy 有界重试，最终记 failed trigger）。幂等键 `schedule:{scheduleId}:occ:{occurrenceId}` 三层生效：admission 侧稳定 commandKey（复用 Coordinator `recordedCommandKeys` 模式）、task store 唯一约束、dispatcher workflow ID 本身（Temporal workflow ID = 幂等键）。备选：schedule 直接投递 task queue 由 worker admission——拒绝，admission 必须在控制面 fail closed、写审计，且不能让调度设施绕过租户/预算检查。

### D4. missed/skipped 事件靠对账，不靠调度设施原生事件

Temporal Schedules 原生不提供稳定的"missed"业务事件。设计：dispatcher workflow 成功路径写 `schedule_trigger_events`（occurrence、结果、task 引用）；对账 activity（复用 P6 reconciler 惯例）周期性按触发规则推算期望 occurrence 窗口，与已记录事件差集 → 记 missed/skipped + 指标。overlap 策略用 Temporal 原生 OverlapPolicy（SKIP/ALLOW_ALL/BUFFER_ONE）直接映射。

### D5. Release 绑定：FIXED 创建时固化，FOLLOW 每次触发 admission 时解析

FIXED：创建 schedule 时锁定 release digest，写进 schedule 快照。FOLLOW：dispatcher 每次 admission 时解析 active release + rollout policy，解析结果固化进该次 Spec（符合终版架构"语义变化 = 新 Attempt/Spec"）。首版 FOLLOW 语义 = "当前 active release 即用"，灰度节奏由既有 rollout-policy 表达。

### D6. `EFFECT_UNKNOWN` 裁决：不复活终态，裁决产生新 Attempt

Resolution API（`POST /v1/effects/resolutions`）不修改原 coordinator workflow（终态不可变，authority 矩阵不破）。裁决落 append-only 审计表；"未提交 + 继续"路径经 admission 生成**新 Spec/attempt**（携带原 effect 记录引用与裁决引用），新建 coordinator run；"已提交 + 继续"路径依赖 Effect Ledger 既有幂等（同 `semantic_action_id` replay 返回已提交结果，天然不重复执行）。备选：向原 workflow 发 RESOLVE signal 复活——拒绝，破坏"终态不可变"与 History authority 简单性。

### D7. 认证：pilot 链路静态 service token（哈希存储、常量时间比较、可轮换）

服务端从 secret 注入 token 哈希集合，`Authorization: Bearer` 验证（常量时间比较、多 key 并存支持轮换）；packages/apps/runs/schedules/resolutions 链路强制，明文信任头在这五条链路停止提权（本地开发用 dev token，经 env 注入）。备选 OIDC——延后（Non-Goal），token 方案足以消除"可伪造信任头"威胁并支撑无人值守 pilot。`scripts/register-package.ts` 与文档同步改为携带 token。

### D8. Schedule 预算账户：Ledger 内新聚合维度，不是第二账本

`consumption-ledger` 扩展 schedule 账户表（账户 = schedule 粒度聚合上限 + 可选窗口），invocation 结算时同步累加 schedule 账户（同事务）；dispatcher admission 前置检查 schedule 账户权威余额。余额 authority 唯一（Ledger），schedule 账户是 ledger 内的账户维度而非独立 store。备选：task store 记账——拒绝，破坏单一权威矩阵。

### D9. Soak harness 双轨：压缩时钟自动化等效 + 真实窗口证据项

`platform/scripts/p8/` 提供 soak runner：`soak.config.json` 声明窗口、频次、触发下限、成功率阈值、故障注入清单（provider 失效、worker 重启、投影延迟、预算耗尽、pause/resume）；时钟源经 adapter 注入，压缩时钟在集成环境跑等效窗口（`pnpm test:p8:exercises`，对齐 P7 惯例），输出机器证据 JSON 到 `platform/evidence/p8/`。真实 14 天 soak 由真实环境执行，作为运行门证据项（可 UNFILLED）。

### D10. 失败类别→告警映射表收口在 `production-governance`

新增 failure-taxonomy 模块：稳定错误码 → {告警规则、runbook 引用、响应路由要求} 的单一映射表；Prometheus 规则与 Grafana 注解从该表生成（延续 P7 的"每条规则有 responder 与 runbook 注解"纪律），未知错误码兜底告警。

## Risks / Trade-offs

- [Temporal Schedules 对 missed 窗口的原生可见性弱] → D4 对账补偿记录 + 指标；接受"发现延迟一个对账周期"
- [调度设施单点（本地 compose 单 Temporal）] → 风险显式接受台账（运行门阻断项），不伪装为 HA
- [静态 service token 弱于 OIDC] → 威胁模型仅要求"消除可伪造信任头 + 可轮换"；OIDC 列入后续
- [FOLLOW 绑定与 rollout policy 集成面大] → 首版 FOLLOW 仅消费 active release；灰度由既有 rollout-policy 表达，不新增策略引擎
- [双预算维度一致性] → schedule 账户与 invocation 结算同事务累加，Ledger 单 authority；对账复用既有 reconciler
- [resolution 与新 attempt 的 effect 语义误解] → "已提交"路径强制走 Effect Ledger replay 幂等，测试覆盖"裁决后不重复副作用"
- [soak 真实窗口长、易被短窗结果冒充] → 证据 schema 记录窗口起止与触发数，门校验时窗与下限；UNFILLED 显式阻断

## Migration Plan

1. DB migrations（schedules、occurrences/trigger events、resolutions 审计、ledger schedule 账户）先行，向前兼容
2. Feature flag（pilot 租户白名单）控制 schedule 能力与 pilot 强认证的生效面；关闭 flag 即回滚到既有行为，已启动 run 不受影响（按原 Spec 跑完）
3. Temporal 侧：新增 schedule 与 dispatcher workflow type，不触碰 `AgentTaskWorkflow`/`DurableCoordinatorWorkflow` 历史；Worker 发布走既有 Build-ID gate
4. 验证顺序：单测 → 集成（真实 Postgres/Temporal 垂直链路）→ 压缩时钟 soak exercises → 边界检查（`check-p8-boundaries`：canonical 契约无调度设施类型、Workflow 无 I/O）

## Open Questions

- 高危 effect（写副作用强风险级）的裁决是否要求双人复核——首版单签 + 不可变审计，若 pilot 评审要求再加
- schedule 账户结算窗口默认值（首版月度，产品侧可后调）
- 告警响应主体（oncall roster）真实人选——人类输入，运行门证据项，保持 UNFILLED 直到提供
