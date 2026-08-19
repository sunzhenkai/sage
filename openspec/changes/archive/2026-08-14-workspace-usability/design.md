## Context

T0001 已将 Fastify API、Temporal Worker、React/Vite Web、PostgreSQL Chat/Task stores 与 Local PiHarness 装配为本地纵向链路，其 delta 已同步到主 spec但 change 仍 active。T0002 必须把该主 spec视为依赖基线，并在 T0001 之后应用/归档：同时完整修改 `chat-user-interface` 与 `local-application-runtime` 的首访契约，避免后续同步顺序把自动创建行为带回。当前 Web 首访逻辑会无条件创建固定标题 session，ChatStore 没有 history list，Workspace navigation 不能恢复 session/task。Provider profiles 又把 Local Pi、editing、enabled 与 runtime-in-use 混在一起，且没有 Provider/Model Catalog、持久 cache、scheduler 或同步审计。

本变更跨 `app-contracts`、Chat store/API、Web、PostgreSQL migration、API runtime lifecycle 和新 Catalog 模块。外部 source 为公共 `https://models.dev/api.json`；它提供 ETag，但约 3.7 MiB payload、字段可能扩展，且并非所有 provider 都提供 base URL。PostgreSQL 是 session 与 Catalog 权威；browser profile metadata 保持 local，secret 只在当前 tab 的 `sessionStorage`。D1–D26 均为 accepted，设计不存在阻塞性选择。

## Goals / Non-Goals

**Goals:**

- 在 retention 范围内分页发现、筛选和恢复全部仍存在的 Chat session，并以显式 New Chat 替代首访自动创建。
- 让 Chat、Tasks、Providers 使用可恢复的 native canonical URL，并修复 IME、promotion、Task activation/竞态、移动端和状态文案。
- 用 PostgreSQL global snapshot/LKG 和跨实例 single-flight 安全同步 `models.dev`，只向浏览器暴露 active revision 的白名单 projection。
- 将 Local Pi System runtime 与 browser-local Provider profile v2 分离，提供 catalog-assisted metadata 与 provenance，不改变实际执行链。
- 以 ordered migration ledger、targeted tests、PostgreSQL integration、typecheck/build 和 desktop/mobile smoke 支撑增量交付。

**Non-Goals:**

- 不实现 provider-backed execution、adapter registry、server-side profile/secret sync、OAuth、live provider verification或 Sage vetted base URL overrides。
- 不实现 Chat transcript 全文检索、strict snapshot pagination、session close/reopen/delete/rename或 retention deletion job。
- 不引入 SPA Router、API+Worker global health aggregation、production auth/HA/deployment，亦不改变 T0001 的 Vite dev/preview、可配置 `/v1` proxy、built app、Temporal Worker、PiHarness 或 Task target routing边界。
- 不向浏览器透传 raw Catalog payload，不把完整 live fixture 提交 Git，不让 live endpoint 成为 deterministic CI gate。

## Decisions

### 1. Session history 使用 enriched keyset continuation，而不是 strict snapshot

`GET /v1/chat/sessions` 返回 `SessionHistoryItem`，包含 `sessionId/status/title?/preview?/lastMessageRole?/lastMessageAt?/createdAt/updatedAt/retentionEligibleAt`，不嵌入 transcript、runs、summaries 或 message count。默认 `limit=30`、最大 100；`status=all|open|closed`；`q` 最多 100 code points 且只按 title 做 escaped literal contains。

查询先按 tenant 与 `(updated_at DESC, session_id DESC)` 取 session page，再用 lateral lookup 获取最新 persisted message 的安全 preview。Cursor 是绑定 normalized filters 的 versioned opaque token，内部 `sortTime` 必须直接来自 PostgreSQL UTC 六位微秒规范文本，不能由 JavaScript 毫秒 `Date` 重建。稳定排序键不会重复/跳项；并发 create/update 到 cursor 之前的记录由刷新首屏收敛，明确不提供 strict snapshot。相比 offset，此方案避免稳定数据集漂移；相比 stateful MVCC cursor，不引入 lease 与运维复杂度。

Workspace New Chat 的 `POST /v1/chat/sessions` request body不得发送 `Local Sage Chat` 或任何其他占位 `title`；API/store以 `title=NULL` 创建。首条 persisted user message随后在 message/run/event 的同一事务内为该 `NULL` title派生最多80 code points的辨识标题；artifact-only使用安全label。Runtime派生只匹配 `NULL`，因此未来API显式设置的任意title（包括 `Local Sage Chat`）均不得覆盖。Preview最多160 code points，只读text或artifact reference metadata，不读取body。一次性migration仅保守回填历史 `NULL` 或精确legacy `Local Sage Chat`；后者因旧schema无provenance，是明确接受且需integration test的例外。`retentionEligibleAt=updated_at+retention_days`只表示最早eligible时间，不承诺删除时刻。

### 2. 共享 ordered PostgreSQL migration runner

引入 `sage_schema_migrations(component, version, checksum_sha256, applied_at)`。每个 component 使用显式排序 manifest、dedicated connection 和 advisory lock；已应用 version checksum 变化必须 fail fast，pending migration 执行并记录 checksum，已发布 SQL 不得重写。Chat `002` 增加 history indexes/title backfill；Catalog 使用独立 component/version 创建 snapshot/state/attempt schema。相比各 store 只读单个 `001.sql`，ledger 可审计且能安全扩展；migration 自身保持幂等以承受 SQL 成功后 ledger 记录前的崩溃重试。

### 3. Canonical URL 与资源级交互契约

统一 `workspaceHref({view,sessionId?,taskId?})` 生成 native link：Chat session 为 `/?session=...`，Task detail 为 `/?view=tasks&task=...[&session=...]`，Providers 保留 `session`。非 tasks view 丢弃 `task`，裸 `/` 是 landing。浏览器 full-page navigation 自然恢复 direct URL、refresh、Back/Forward，不注册自制 `popstate` store。

裸 `/` 不发创建请求；本地 Web entrypoint仍提供Vite `dev`/`preview`、可配置 `/v1` proxy并可服务built app，但无session时只渲染landing/history。只有显式New Chat才发送一次不含`title`字段的POST，成功后导航到canonical URL。该修改仅覆盖本地Web首访产品行为，不改变生产部署、API/Worker composition或其他runtime边界。session 404/被retention删除显示recovery state，不创建替代项；closed session只读。打开session时先验证detail，加载persisted events，再以latest durable sequence建立SSE并按sequence去重。

Composer 只在非 composition 的 Enter 提交一次；Shift+Enter 换行，IME Enter 不提交，empty/submitting click/Enter 均 no-op，失败保留 draft。Text timeline additive 增加可选 `promotionEligibility`；新 persisted user text 为 `explicit`，assistant 为 `none`，历史缺失 fail-closed。它只控制展示，server 仍验证 source/authorization；promotion body 仍只有 `mode/taskType/ruleId`。

Task row 仅有一个 native anchor。每次 task URL boot 用一个 request token 和 AbortController 并行加载 detail/events/artifacts，只有 token 与 taskId 都匹配时整体提交；新 activation abort 旧组。`390×844` 必须保留 Task ID、execution status 与 projection freshness。

### 4. Catalog 使用 persisted JSONB snapshot 和 active-only immutable projection

选择 API-side PostgreSQL snapshot，而非 browser direct、memory-only 或 6,000+ rows normalized upsert。核心表为：

- `provider_catalog_snapshots`：immutable raw tolerant JSONB、content SHA-256、source metadata、counts、`first_activated_at`；`(source_id, content_sha256)` 唯一。
- `provider_catalog_state`：每 source 的 `active_snapshot_id`、`active_activated_at`、权威 `validator_etag`、checked/success/next-sync/failure/error metadata。
- `provider_catalog_sync_attempts`：trigger/status/owner/deadline/安全审计字段，并用 partial unique index 保证每 source 最多一个 `queued|running` attempt。

Catalog 是 deployment-global public metadata snapshot，无 `tenant_id`，但 reads 仍要求 authenticated workspace principal。只服务 whitelist `ProviderCatalogItem`、`ModelCatalogItem` 与 `CatalogPage`；未知字段只保留 raw JSONB，不进入 public contract。每页同时返回 `snapshotId/activeSince`，cursor 绑定 snapshot 与 filter hash；active revision 变化时旧 cursor 返回 409。

每 request 比较 DB active revision 与进程 `ProjectionCache` revision。不一致时从 DB 同步构建并 atomic swap；失败返回 retryable 503 `CATALOG_PROJECTION_UNAVAILABLE`，旧 cache 只留作恢复材料，绝不冒充 active response。`NOTIFY` 加 60 秒 revision poll 处理多实例刷新与通知丢失。无 snapshot 返回 503；有 stale LKG 且 projection 匹配仍返回 200。保留 active + 前 2 个成功 snapshot；GC 不与 pointer activation 绑成不可恢复动作。

### 5. Source fetch、validator 与 activation 语义固定

Source URL 编译期固定为 `https://models.dev/api.json`，空 body，只发通用 User-Agent 与 state `validator_etag` 对应的 `If-None-Match`；不发送 profile、secret、Chat 内容或用户 query。Fetch 使用 `redirect:'error'`、20s timeout、解压后 streaming 16 MiB cap，只接受 2xx/304 和 JSON content type。

Validator 要求 root/provider/models 的关键 ID/name/type 合法且 map key 一致；未知字段容忍。URL 仅在 parse 成功且 scheme 为 `https:` 时进入 projection。Decoded bytes、SHA-256、counts 和 immutable projection 均在 activation transaction 前完成。

- 304：更新 attempt/check/success/next-sync，保留 active、validator 与 snapshot；无 active 却 304 视为 protocol failure，并清 validator 后 retry。
- 200 same hash/new ETag：不复制 snapshot，不改变 pointer/`active_activated_at`，只更新 state validator 与成功 metadata。
- 200 new content：事务内 deduplicate/insert snapshot、切 active pointer、更新 validator/state/attempt；任一步失败保留旧 LKG/validator。
- A→B→A：复用已有 A snapshot row，但 pointer 每次切换均设置新的 `active_activated_at`；`first_activated_at` 仍保留首次激活审计语义。

### 6. Persisted single-flight、调度、授权与 lifecycle

Migration bootstrap 固定 `models-dev` state 并令首次 `next_sync_at=now()`。Startup 在 no snapshot、due 或距 last successful check 超过 24h 时后台 enqueue，不阻塞 listen/readiness。成功/304 后安排 24h 加按 source ID 确定的 ±15 分钟 jitter；失败按 5m→30m→2h→6h cap retry，成功清零。

Enqueue transaction 锁 state row，复用已有 active attempt，否则插入唯一 queued attempt。Coordinator 使用 dedicated PG connection 持 advisory lock覆盖 claim、fetch 与 activation，并以 CAS `queued→running` 写 owner/start/deadline。Queued 超过 60s可重新 claim；running 超 deadline 只有成功取得同一 advisory lock的实例可标 `cancelled/SYNC_OWNER_LOST`，再走正常 enqueue。Manual 与 daily 共用机制；无 active attempt 且最近 completed check不足60s时返回429，否则 POST 返回202并复用同一 attempt。

Reads 要求authenticated workspace principal；该权限也可读取单个sync attempt的有界公开状态。Attempt response只包含`attemptId`、`trigger`、`status`、有界lifecycle timestamps与可选safe `errorCode`，不得暴露`principal_id`、`authentication_id`、`owner_id`、response body、stack或内部audit字段；未知ID稳定返回404 `CATALOG_SYNC_ATTEMPT_NOT_FOUND`。Manual sync只允许`provider-catalog-admin`，local principal显式加入，但不宣称production auth已完成。Catalog不参与`/readyz`。

Shutdown 只有一个合法顺序：`manager.beginShutdown()` 进入 closing、clear timer、拒绝 manual、abort fetch；随后 `app.close()`；再 `manager.close()` bounded wait、cancel owner attempt并释放 advisory/NOTIFY connection；最后关闭 Temporal clients，并以 `Promise.allSettled` 关闭 Chat/Task/Catalog stores/pools。异常启动复用同一 helper，不遗留 timer/listener/promise。

### 7. Browser profile v2 与 runtime 严格分离

Local Pi 从 profile list 移除，静态呈现为唯一 `System runtime · In use`。外部 profile 只有 editing state、availability intent 与 derived metadata status，永不显示 Active/Running/In use，也不驱动 `createLocalAgentClient()`。

`ProviderProfileV2` 保存稳定 id、name、enabled、`adapterKind`、provider/model ID/name、可选 base URL、`baseUrlSource`、catalog snapshot provenance 与 `updatedAt` 到 `sage.provider-profiles.v2`。不持久化 API key 或 `apiKeyConfigured`；presence 每次从 `sessionStorage` prefix 派生，保存后清空 React secret draft。

Provider/model combobox 使用 250ms debounce、AbortController、request token、snapshot match、keyboard/ARIA；provider 变化清 model 和 source URL，manual URL默认也清除，除非用户显式确认保留。选择 model 使用 `model.provider.api ?? provider.api` 的有效 `https:` URL并保存 provenance；source 缺失不猜 endpoint，可手工输入。Catalog 不推断 adapterKind，已保存 profile 不因 daily sync自动改写。

`enabled` 仅代表未来 picker 可用意图。`unassigned` 在 metadata 完整时可成为 `Available metadata`但不可执行；URL-based adapter 必须有合法 `https:` base URL才能以 enabled 保存，缺失时仍可保存 disabled draft。Create/edit/Cancel 使用 discriminated state，不再使用 sentinel fallback。

Migration 优先读取合法 v2；非法 v2 显示 recoverable error且不覆盖。v2 不存在才读取 v1。所有 legacy `kind='local'` 都隔离且不迁入 external profiles；其他记录按稳定 id迁移，合法 URL 标 manual，失配 enabled 降为 false并告警。保留 v1 rollback key，不迁移 `apiKeyConfigured`，全新 browser 不生成默认 external profile。

### 8. 状态词汇与 payload boundary

Sidebar/topbar 只陈述 `Local development mode`、`Runtime: Local Pi Harness` 等事实；Chat 只描述当前 SSE，Catalog 只描述 available/stale/unavailable，Task 只展示 persisted execution status 与 projection freshness。禁止无聚合证据的 `API + Worker online`、`All systems operational`。Catalog stale/unavailable 不影响 Sage readiness。

Chat submit/retry/promotion 与 Task create/signal/cancel/retry schema 保持 `additionalProperties=false`；provider、model、profile、base URL、API key、target、endpoint、namespace、actor、roles 均不得进入 payload。

### 9. Delta 覆盖、D1–D26 映射与统计

本变更以T0001已同步主spec为依赖，包含4个ADDED capability与5个MODIFIED capability，共9个delta文件、30个requirements和118个scenarios；所有既有覆盖均保留。`local-application-runtime`的完整MODIFIED requirement必须在T0001之后应用，且只改变本地Web无session时的产品行为。

| Delta capability | 操作 | Requirements | Scenarios | 决策映射 |
|---|---:|---:|---:|---|
| `chat-session-history` | ADDED | 5 | 20 | D1–D6、D19 |
| `provider-model-catalog` | ADDED | 10 | 36 | D7–D13、D20–D23、D26 |
| `browser-provider-profile-management` | ADDED | 8 | 25 | D13–D15、D24–D25 |
| `workspace-status-presentation` | ADDED | 1 | 5 | D18 |
| `local-application-runtime` | MODIFIED | 1 | 3 | D1（T0001依赖覆盖） |
| `chat-user-interface` | MODIFIED | 2 | 10 | D1、D16 |
| `chat-event-resumption` | MODIFIED | 1 | 4 | D1 |
| `chat-to-task-promotion` | MODIFIED | 1 | 6 | D17 |
| `task-operations-interface` | MODIFIED | 1 | 9 | D16 |

按决策反查：D1由history/UI/event resumption/local Web runtime共同覆盖；D2–D6与D19由history覆盖；D7–D12、D20–D23、D26由Catalog覆盖；D13由Catalog projection与profile mapping共同覆盖；D14–D15、D24–D25由profile覆盖；D16由Workspace URL与Task interface覆盖；D17由promotion覆盖；D18由status presentation覆盖。

## Risks / Trade-offs

- [Risk] 可变 `updated_at` 使跨页不是 strict snapshot → 明示 continuation consistency，稳定键保证不重复/跳项，并提供首屏 refresh 收敛。
- [Risk] 精确 legacy 占位 title 可能曾由外部显式设置 → 只处理唯一已知占位值，记录迁移例外并加 integration test；未来显式同名不会被 runtime覆盖。
- [Risk] 上游 timeout、schema drift、oversize、redirect 或恶意字段 → fixed URL、redirect error、20s/16MiB bound、strict critical validation、https projection 与 LKG rollback。
- [Risk] 多实例重复 fetch或 owner crash → partial unique attempt、state row lock、advisory lock、CAS claim、deadline+lock orphan recovery。
- [Risk] cache notification丢失或 rebuild失败 → 60s poll与 request-time revision check；失败503，不服务旧 revision。
- [Risk] 用户误认 external profile 已执行 → System runtime 独立，profile 文案禁用 Active/In use，payload negative tests 与 PiHarness assembly test固定边界。
- [Trade-off] 每实例需持有一个 immutable projection，换取 read path简单与 snapshot atomicity；若未来需要复杂分析再构建 normalized read model。
- [Trade-off] native full-page navigation会重载数据，但无需新增 Router/state synchronization，并保留浏览器原生 link语义。

## Migration Plan

1. 先交付 shared contracts 与 ordered migration runner；登记既有 migration checksum，再应用 Chat history与 Catalog additive schema。
2. 实现Chat list/title/preview store与strict API，验证New Chat省略`title`→数据库`NULL`→首条persisted user text事务内派生，以及未来显式`Local Sage Chat`不被覆盖；完成PostgreSQL tenant/cursor/title/retention integration后再替换Web auto-create。
3. 以T0001已同步主spec为基线完整覆盖本地Web entrypoint的无session行为，同时保留Vite dev/preview、可配置`/v1` proxy与built app；再实现canonical URL、landing/history、resumption、Composer、promotion、Task request group、mobile与中性状态，且不改生产/runtime边界。
4. 实现 Catalog store/projection/source validator和 deterministic fixtures，再实现 sync coordinator、routes、auth、scheduler与 fixed lifecycle；automatic due scheduler最后开启。
5. 实现 profile v2 loader/migration、显式 editor state、catalog selectors、mapping/provenance和secret边界。
6. 补 models.dev MIT attribution、targeted tests、PostgreSQL multi-manager integration、typecheck/build、desktop与 `390×844` browser smoke；live `models.dev` 只由显式 opt-in执行。

回滚 Web 时可保留 additive API/schema；关闭 scheduler不会删除 LKG，read route可继续服务。不得修改已发布 migration或自动删除 v1 profile key、snapshot tables、生成的 title/index。Catalog schema只做 additive rollback，避免破坏 active data。

## Open Questions

无阻塞问题。实现可在不改变架构的前提下固定 package 名为 `@sage/provider-catalog`、jitter 为 source-derived ±15 分钟，并补齐 safe error code 枚举与最终 UI copy。
