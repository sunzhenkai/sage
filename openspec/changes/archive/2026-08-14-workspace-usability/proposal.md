## Why

T0001 已提供可运行的本地 Chat→Task→Worker→Web 链路，但 Workspace 仍会在首访时隐式创建 Chat session、跨视图丢失会话、暴露无效操作并产生 Task 导航竞态；Provider 页面也缺少可信的 metadata catalog、同步恢复能力和清晰的 runtime/profile 边界。现在需要把已接受的 D1–D26 固化为可验证契约，使 retention 范围内的会话可恢复、Workspace 交互与 URL 一致，并在不改变 Local PiHarness 执行边界的前提下提供安全、可观测的 Provider/Model Catalog。

## What Changes

- **BREAKING**：以已同步到主 spec 的 T0001 为依赖基线，完整覆盖 `chat-user-interface` 与 `local-application-runtime` 的首访行为；裸 `/` 只显示 landing 与 session history且不得发送创建请求，只有用户显式执行 New Chat 才以不含占位 `title` 的请求创建 `NULL` title session。
- 增加 tenant-scoped Chat session history、opaque keyset cursor、安全 title/preview、retention 展示和 stale session recovery；分页采用 continuation consistency，不承诺跨请求 strict snapshot。
- 统一 Chat、Tasks、Providers 的 native canonical URL，保留当前 `session`；修复 IME-safe Composer、promotion eligibility fail-closed、Task 单次 activation/竞态和 `390×844` 状态展示。
- 增加固定 `https://models.dev/api.json` 的 API-side Catalog：PostgreSQL global snapshot/LKG、ETag/304、startup/manual/daily sync、跨实例 single-flight、白名单 projection、独立授权和确定性 shutdown。
- 将 Local Pi 表达为独立只读 System runtime；引入 browser-local Provider profile v2、catalog selector、来源可解释的 base URL 与安全 legacy migration，secret 仍仅存 `sessionStorage`。
- 将 shell/global health 文案收敛为有证据的中性 runtime 事实；Catalog 可用性不进入 `/readyz`。
- 保持 Chat/Task request contract 严格不变：不得加入 provider、model、profile、base URL、target、actor 或 roles 字段，profile 不驱动 PiHarness/runtime。

## Capabilities

### New Capabilities

- `chat-session-history`: retention 范围内 session 的分页发现、筛选、安全 title/preview、显式创建、continuation cursor 和 stale URL recovery。
- `provider-model-catalog`: `models.dev` snapshot、validator、LKG、同步协调、projection read/status/admin API、授权与生命周期。
- `browser-provider-profile-management`: System runtime/profile 分离、profile v2、catalog-assisted selector、provenance、secret/storage 与 legacy migration 边界。
- `workspace-status-presentation`: shell、Chat、Task、Provider 与 Catalog 的中性且有作用域的状态表达。

### Modified Capabilities

- `local-application-runtime`: 完整替换已同步的 `Local Web runtime entrypoint`，保留 Vite dev/preview、可配置 `/v1` proxy 与 built app 契约，但将无 session 自动创建改为 landing/history 与显式 New Chat；不改变生产或其他 runtime 边界。
- `chat-user-interface`: 以 landing/history 和显式 New Chat 替代 T0001 首访自动建 session，并增加 session-preserving navigation、closed read-only 与 IME-safe Composer。
- `chat-event-resumption`: 从 canonical session URL 恢复 persisted events，再从最新 durable sequence 续接 SSE，缺失 session 不得静默替换。
- `chat-to-task-promotion`: text event 增加可选 `promotionEligibility`，仅 eligible persisted user message 显示 CTA，历史缺失字段 fail-closed，server authorization 与 strict payload 保持权威。
- `task-operations-interface`: Task detail 使用 native canonical URL，一次 activation 只加载一组详情，防止旧响应覆盖，并在移动端保留 execution status 与 projection freshness。

## Impact

- Contracts/API：`platform/packages/app-contracts`、Chat/Task API routes、Catalog read/status/sync routes 与 `provider-catalog-admin` local role。
- PostgreSQL：共享 ordered migration ledger、Chat history indexes/title backfill，以及 Catalog snapshot/state/attempt 表和 advisory-lock coordination。
- Runtime：`createApiRuntime()` Catalog manager、background due check、projection cache 与固定 shutdown 顺序；Web 仍使用 T0001 的 Vite dev/preview、可配置 `/v1` proxy 与 built app entrypoint；不修改生产部署边界、Worker、Temporal、Local PiHarness 或 `/readyz` 语义。
- Web：Chat landing/history、统一 URL builder、Composer/Promotion/Task 交互、Provider profile v2/selector 和中性状态文案。
- 外部依赖与资产：只由 API 请求固定 `models.dev` endpoint；保留 MIT attribution，CI 使用裁剪 fixture，live endpoint 仅用于 opt-in smoke。
- 验证：targeted contract/store/API/UI tests、PostgreSQL integration、typecheck/build，以及 desktop 与 `390×844` browser smoke。
