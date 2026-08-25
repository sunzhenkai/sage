# Design — run-agent-settings

## Context

- 包运行执行路由现状：`agent-worker/src/runtime.ts` 的 `readLiveProviderRouteFromEnv()` 以 `MINIMAX_API_KEY` 非空为唯一开关，缺 key 静默回退 echo（`LegacyPiHarness`），任务假成功（见 `package-run-live-provider` spec 与 design D2）。
- 准入现状：`agent-api/src/runs-api.ts` 的 `POST /v1/releases/:releaseId/runs` 只做 release/manifest/entry 校验与 admission 幂等，没有任何执行依赖检查。
- 存储现状：`task-domain` 定义 store 端口并并入 `TaskStorePort`，`task-store-postgres` 用编号 SQL 迁移落表（001–004）。`TaskStorePort` 仅 task-domain 与 postgres 实现两处引用，扩展安全。
- chat 链路的 provider 走 localStorage profile + 请求体携带 route，与包运行「受信进程 env」是两条刻意分离的通道，本 change 不合并。

## Goals / Non-Goals

- Goals：默认 provider 设置持久化 + API；准入与执行两层依赖检查（固定 minimax 缺 key 显式失败）；auto 缺省零行为变化；回退/模式可观测（WARN + readyz）；web 设置入口。
- Non-Goals：通用 ModelRouteResolver、设置面保存密钥、chat 机制合并、production 准入语义（见 proposal Non-goals）。

## Decisions

### D1. 设置是 per-tenant 单例、三态、非密钥
`run_agent_settings` 表：PK `tenant_id`，列 `default_provider`（`auto|minimax|echo`）、`updated_at`、`updated_by`。无行等效 `auto`——这是兼容键：未写过设置的租户行为与今天完全一致，`package-run-live-provider` 既有 spec 场景不破坏。不做 per-app/per-run 覆盖（运行请求体继续只接受 `input`/`taskId`，严格字段边界不放松）。

### D2. 可用性解析 = 受信 env 非空检测，跨进程假设写明
「依赖检查」的判据是进程受信 env 中 `MINIMAX_API_KEY` 是否非空，不做网络探测（连接探测已由 provider-catalog 的 check-connection 独立提供，不自动触发）。agent-api（准入+GET 可用性）与 agent-worker（执行）各自读各自进程的 env：本地栈两者从同一环境启动时判定一致；若不一致，worker 层是权威 fail-closed，API 层误放行的 run 会在 worker 处以 `PROVIDER_DEPENDENCY_MISSING` 失败，不会静默 echo。API 误拒（API 有 key 而 worker 无）不可能发生——API 只在「自己进程无 key」时拒绝。

### D3. 两层检查、错误码统一
- 准入层（runs-api）：读设置（store 缺行→auto）→ `minimax` 且 env 无 key → 409 `PROVIDER_DEPENDENCY_MISSING`（retryable=false，消息指引配置 `MINIMAX_API_KEY` 并重启 API 与 worker）。发生在 assemble/admission/writePackageInput 之前。
- 执行层（activities）：`executeAgentSlice` 对 `task-input://package/` 输入，按设置解析 harness：`echo`→显式 echo client；`minimax`→无 route 抛 `PROVIDER_DEPENDENCY_MISSING`（Temporal 重试后任务 failed，不写 run 输出）；`auto`→现状。设置每次 slice 读取（不做进程缓存），改设置即时生效。

### D4. 存储与接口落点
`task-domain`：`RunAgentSettingsRecord` + `RunAgentSettingsStore`（`getRunAgentSettings` / `upsertRunAgentSettings`，幂等 upsert）并入 `TaskStorePort`。`task-store-postgres`：迁移 `005_run_agent_settings.sql`（`INSERT ... ON CONFLICT (tenant_id) DO UPDATE`）。agent-worker 与 agent-api 复用同一 `PostgresTaskStore` 实例读设置，不新增连接。

### D5. 观测对称
worker 启动：live route 存在时保留现有日志行；不存在时输出 WARN「`MINIMAX_API_KEY` not set — package runs fall back to local echo harness (settings defaultProvider=auto)」。`/readyz`（含 503 分支）响应体加 `provider: { mode: 'live'|'echo', modelId? }`（worker 进程视角、非设置视角；不含 key）。GET 设置响应的可用性是 API 进程视角，两者字段名区分（`providerMode` vs `providers[].available`），文档写明。

### D6. web 设置卡放 Providers 页
`agent-web/src/providers.tsx` 顶部新增「运行 Agent」卡：下拉（跟随现有 locale 文案机制）选 auto/minimax/echo，展示 GET 返回的可用性与说明；不新建路由视图，避免动 workspace 导航。

## Risks / Trade-offs

- [API/worker env 不一致导致判定分叉] → worker 权威 fail-closed 兜底；readyz 与 GET 设置都暴露各自视角，排查一眼定位
- [活动抛错触发 Temporal 重试拉长失败反馈] → `PROVIDER_DEPENDENCY_MISSING` 属配置错误，消息稳定；重试上限后 failed 的既有语义可接受（与 provider 调用失败同路径）
- [设置表成为新的读放大点] → 每 slice 一次主键点查，量级与 task 投影读取相同，可忽略
- [auto 缺省语义依赖「无行=auto」] → 迁移不回填行；读取端统一 `?? 'auto'`，删除行即回退现状（回滚策略）

## Migration Plan

1. 迁移 005 前向新增表，无数据回填，随 worker 启动 `migrateStores` 自动执行；回滚删除表即可（设置丢失=回到 auto）。
2. 部署顺序无强约束：API/worker 可先后升级；旧 worker + 新设置的场景由准入层拒绝兜底。

## Open Questions

- none
