# 提案：AI App 无人值守定时运行 Pilot（sage-p8-unattended-schedule-pilot）

## Why

平台当前只能运行"被请求一次"的任务：P6 exit review 明确不含 Schedule，全仓没有任何定时/周期触发入口；同时无人值守运行的失败出口（`EFFECT_UNKNOWN` 人工裁决协议）、跨 run 的预算护栏、以及 pilot 运行门（真实认证、告警到人、风险显式接受）均未闭环。这意味着系统今天是一个 Agent 运行时，还不是"AI App 长期、定时、稳定运行平台"。本变更是下一个大里程碑（P8）：让一个 AI App Release 由 Schedule 驱动，7×24 无人值守定时运行，期间故障要么自愈、要么按策略稳定失败并告警到人，全程无静默重复执行且每次触发可审计。

## What Changes

- **Schedule Plane（新能力）**：
  - Canonical Schedule 契约：cron/interval/timezone、misfire/catch-up 策略、overlap 并发策略、pause/resume、调度边界（允许环境/能力复用 WorkflowTargetSnapshot 约束）；运行绑定必须完整声明 `releaseBinding（FIXED/FOLLOW） + task + 固化 params`，创建时按目标 Release 校验绑定合法性；Temporal SDK 类型不进入 canonical 契约。
  - Temporal Schedules Adapter：Temporal `auto-setup:1.29.1` 原生 Schedule 作为当前 adapter 实现，与 Durable Coordinator Adapter 同一隔离纪律。
  - 触发接线：每次触发产生唯一 occurrence（幂等键含 task 与固化参数值），以固化 task/params 走既有 `agent-run-admission` 包运行准入（`package-run-input-resolution` 语义：声明参数校验/默认值、dataSources 受控获取与 onFailure 语义），生成新 `AgentTaskSpec` 与新 attempt；schedule 绑定 Release 的语义（固定 digest 或按 policy 跟随新 Release）在 admission 时固化，FOLLOW 解析不兼容（缺同名 task 或 params 不合法）时触发稳定失败并告警、不静默跳过。不存在任何调度专属人工输入通道。
  - Schedule API/UI/审计：创建、列表、详情、pause/resume、触发历史；所有管理操作进审计。
  - 观测：missed/failed trigger 指标、schedule 维度告警与 runbook 注解。
- **无人值守失败自治（新能力）**：
  - `EFFECT_UNKNOWN` resolution 协议：结构化裁决 API（resolve → retry 新 attempt / terminate）、不可变裁决审计、与告警 runbook 联动。
  - 失败分类到告警路由的完整映射：fallback 耗尽、admission 拒绝、预算超限等无人值守场景均产生可路由告警。
  - 自动重试在预算护栏内的语义：retry 不绕过 ledger，超限 fail closed。
- **Schedule 级预算账户（consumption-ledger delta）**：schedule 维度聚合硬上限（如月度 token/cost/quota），reserve 前检查，超限 fail closed；既有 reservation/commit/release 语义不变。
- **无人值守 pilot 运行门（新能力）**：
  - 认证最小集升级：AI App 注册/运行/schedule 链路以 service token 认证替代 `x-authentication-id` header stub。
  - 告警路由到真实响应人（oncall roster 配置）；单点 PostgreSQL 等风险写入显式接受台账（沿用 P7 的诚实证据纪律：未获得的生产证据保持 UNFILLED，不伪造）。
  - Soak 验收准则与自动化等效验证：验收目标为 14 天 / ≥100 次触发 / 注入故障自愈或稳定失败；本变更交付可配置时长的 soak harness 与压缩时钟集成验证，真实 14 天 soak 作为运行门证据项（可为 UNFILLED，由门裁决）。
- **e2e（ai-app-lifecycle-e2e delta）**：schedule 触发路径纳入 AI App 全生命周期端到端验证。

不改变既有 Chat/Task/admission/durable coordinator 行为；`AgentTaskSpec`、Envelope、Effect/Consumption Ledger 权威矩阵不动。

## Capabilities

### New Capabilities

- `ai-app-schedule-plane`: 定时调度一等公民——canonical Schedule 契约、Temporal Schedules adapter、触发→admission 接线、schedule 生命周期与 API/UI/审计、schedule 观测。
- `unattended-run-autonomy`: 无人值守失败自治——`EFFECT_UNKNOWN` resolution 协议、失败分类→告警路由映射、预算护栏内的自动重试语义。
- `unattended-schedule-pilot-gate`: 无人值守定时 pilot 运行门——service token 认证、告警路由到真人、风险显式接受台账、soak 验收准则与 go/no-go 衔接。

### Modified Capabilities

- `consumption-ledger`: 新增 Schedule 级预算账户 requirement——schedule 触发的 run 记账到 schedule 账户并受聚合上限约束，超限 fail closed；既有 reservation/commit/release 与幂等语义不变。
- `ai-app-lifecycle-e2e`: 新增 schedule 触发路径的端到端验证 requirement——全生命周期验证覆盖"注册 → Release → schedule 创建 → 定时触发 → admission → 运行 → 投影可见"。

## Impact

- **packages**：`platform-ports`（Schedule canonical 契约与 Port）、新 `temporal-schedules` adapter（或并入 `temporal-routing`/`temporal-registry`，由 design 裁决）、`agent-run-admission`（schedule trigger 来源与 occurrence 幂等）、`agent-state-postgres`（schedule 存储与投影、ledger schedule 账户）、`production-governance`（resolution 协议、告警映射）、`agent-contracts`（resolution 命令契约）。
- **apps**：`agent-api`（schedules/resolution API、pilot gate 接线、service token 认证）、`agent-worker`（resolution 操作与告警配套）、`agent-web`（Schedule 管理 UI、裁决界面）。
- **基础设施**：Temporal Schedules 能力启用（服务端 1.29 已支持，无版本升级）；`compose.yaml` 不新增服务。
- **兼容性**：不修改既有 API 行为；新增端点独立前缀（`/v1/schedules`、`/v1/effects`）；header stub 认证在 pilot 链路被 service token 替代属**行为变化**，需在 run-agent-settings/包注册调用方同步（**BREAKING（局部）**：本地脚本 `register-package.ts` 需携带 service token）。
- **假设（记录在案）**：阶段编号沿用仓库滚动 Phase 惯例记为 P8；schedule 绑定 Release 默认"固定 digest"，跟随 policy 作为可配置项；soak 验收默认 14 天/≥100 次，harness 参数可配置。
- **排序约束（ai-app-self-contained-runs-driver）**：P8 实施排期晚于 driver 的 `manifest-v2` 与 `input-binding` 子变更完成；本提案的绑定契约（task + 固化 params + releasePolicy）与触发走统一准入的语义由该 driver 的 schedule-binding 子变更修订引入。
