# run-agent-settings

## Why

本地包运行（ai-app）的执行 provider 完全由 agent-worker 进程的 `MINIMAX_API_KEY` 隐式决定：缺 key 时静默回退 echo harness，任务照样成功、输出为「已收到：…」，与 manifest 声明的真实模型目标大相径庭，且运行前没有任何依赖检查或设置面可以让使用方固定/查验默认 provider。需要一个「运行 agent 设置」（可指定默认 provider）与运行前 provider 依赖检查，让依赖缺失在运行前显式失败而不是执行后静默降级。

## What Changes

- 新增「运行 agent 设置」：per-tenant 持久化设置（Postgres 新表 `run_agent_settings`），核心字段 `defaultProvider ∈ {auto, minimax, echo}`；未配置时等效 `auto`（完全保持现状）。设置只含非密钥字段，API key 仍只存在于 worker 进程受信 env，不落任何存储
- agent-api 新增 `GET/PUT /v1/run-agent/settings`：读取/更新默认 provider，GET 响应附带按受信 env 非空检测解析出的 provider 可用性（`available` 与非敏感 `reason`），不回显任何密钥值
- 运行前依赖检查（准入层）：`POST /v1/releases/:releaseId/runs` 在组装输入前读取设置——`defaultProvider=minimax` 且受信 env 缺 `MINIMAX_API_KEY` 时拒绝准入（409 `PROVIDER_DEPENDENCY_MISSING`，不可重试，消息附修复指引）；`echo` 与 `auto` 照常准入
- 执行前依赖检查（worker 层 fail-closed）：`executeAgentSlice` 对 package 输入按设置解析执行 harness——`minimax` 且无 live route → 抛稳定错误 `PROVIDER_DEPENDENCY_MISSING`，任务失败、不写 run 输出、绝不执行 echo；`echo` → 显式使用 echo client（即使配置了 key）；`auto` → 现状（有 key 走 live，无 key 回退 echo）
- 观测对称：worker 启动时在 echo 回退（auto 且无 key）输出 WARN 日志；`/readyz` 响应携带非敏感 `providerMode`，使「重启丢 env」立即可见
- agent-web 设置入口：Providers 页新增「运行 Agent」设置卡（默认 provider 下拉 + 当前可用性状态展示）

## Capabilities

### New Capabilities

- `run-agent-settings`: 运行 agent 默认 provider 设置的持久化契约、设置 API、运行前（准入）与执行前（worker）的 provider 依赖检查语义

### Modified Capabilities

- `package-run-live-provider`: 「受信环境变量 provider 路由」的未配置回退语义收窄——仅当运行 agent 设置为 `auto`（或缺省）时保留「回退本地 echo、任务成功」的既有行为；设置固定 `minimax` 时，缺 `MINIMAX_API_KEY` 必须显式拒绝/失败，不再回退 echo

## Impact

| 仓库 | 角色 | 说明 |
|------|------|------|
| platform/packages/task-domain | 必须 | `RunAgentSettings` 记录契约 + `RunAgentSettingsStore` 端口，并入 `TaskStorePort` |
| platform/packages/task-store-postgres | 必须 | 迁移 005 `run_agent_settings` 表 + 读写实现 |
| platform/apps/agent-api | 必须 | 设置路由（GET/PUT）、runs 准入依赖检查、runtime 装配 |
| platform/apps/agent-worker | 必须 | 活动执行前按设置选择 harness 并 fail-closed、启动 WARN、readyz providerMode |
| platform/apps/agent-web | 必须 | Providers 页「运行 Agent」设置卡 |

## Non-goals

- 不做通用 ModelRouteResolver / route→凭据解析（production 蓝图不动）；凭据仍只在受信进程 env
- 不在设置中保存任何密钥或 endpoint 凭据；设置面不回显密钥值
- 不改变 chat 链路的 provider profile（localStorage + 请求体携带 route）机制
- production 部署模式的准入 fail-closed 语义不在本能力范围
