# 优化 Sage Workspace 易用性与交互可靠性

**id：** T0002
**status：** archived
**slug：** workspace-usability
**创建时间：** 2026-08-14

---

## 概述

修复 Sage Workspace 在 Chat、Tasks、Providers 三个工作区中的关键易用性和交互可靠性问题，并补齐完整 Chat session history 与外部 Provider/Model Catalog。用户应能浏览 retention 范围内的全部会话、恢复任意会话、显式创建新会话；Provider 页面从 `models.dev` 同步 provider/model metadata，支持手动同步和每日定时同步，选择后自动填充可验证的名称、ID、base URL 等 profile metadata，同时保持当前真实 runtime 仍为 Local PiHarness，不把未支持字段加入 Chat/Task 请求。

## 背景

T0001 已补齐本地 API、Worker、Web runtime，并重做 Chat、Tasks、Providers 页面。随后从 engineer、product、design/usability 三个视角进行只读 review，并通过桌面浏览器和 `390×844` 移动视口验证。现有页面视觉和基础 loading/error/empty 状态已有改善，但仍存在 session 静默丢失、Composer 键盘提示错误、assistant promotion 死路、Task URL/history 不可恢复、重复详情请求、移动端隐藏执行状态、Provider 状态混乱、create draft 污染及虚假全局 health 等问题。

第一轮 explore 推荐 last-active-only 恢复和 browser-only provider profile。用户于 2026-08-14 明确调整范围：

- 首访改为 landing + 显式 New Chat：确认；
- session 恢复升级为**完整 session history**，不采用 last-active-only；
- `promotionEligibility`：确认；
- Task 使用原生 full-page URL link：确认；
- Local Pi 固定为 system runtime：确认；
- shell 使用中性 health，不做 API+Worker 聚合：确认；
- 新增：Provider 与 Model 列表从用户所称 `model.dev` 获取。调研确认官方服务为 **`models.dev`（复数）**，需要手动同步与每日定时同步，选择后自动填充 profile metadata。

`models.dev` 官方仓库为 `sst/models.dev`，MIT License，公共 endpoint 为 `https://models.dev/api.json`。2026-08-14 实时验证约 185 providers、6,321 models、3,678,142 bytes；支持 CORS `*`、ETag 和 `If-None-Match -> 304`。Provider 数据包含 `id/name/npm/env/doc/api?/models`，model 包含 `id/name/status/capabilities/provider override` 等。Live API 字段多于仓库 schema，Sage ingest 必须容忍未知字段。

重要限制：`models.dev` 并不为所有 provider 提供 base URL。OpenAI、Anthropic、Google、Groq、xAI、Mistral 等 native SDK provider 缺少 `api`；DeepSeek、OpenRouter 等有 provider-level `api`，部分 model 还有 `model.provider.api` override。因此 Sage 可以自动填充所有 provider/model 的 ID 与名称，但仅能从 source 自动填充 `model.provider.api ?? provider.api`；其余 provider 需要 manual base URL 或另行维护 Sage vetted overrides。

本任务基于 `feat-local-application-runtime`（T0001）创建 `fix-workspace-usability`。Provider profile metadata 继续留在浏览器 `localStorage`，API key 只进入 `sessionStorage`。Catalog snapshot 属于公共 metadata，可由 Sage API 持久缓存；真实 provider-backed execution、生产身份和生产部署仍不在本任务范围内。

## 目标

1. 提供完整 Chat session history：retention 范围内所有 session 可分页发现、筛选、打开、刷新和恢复，只有显式 New Chat 才创建 session。
2. 保持 Chat session 在 Chat、Tasks、Providers 之间连续，并让 URL、浏览器历史和当前 workspace state 一致。
3. 使 Chat 输入、Retry、Promote to Task 等操作的文案、键盘行为和后端 capability 一致，不暴露必然失败的 CTA。
4. 让 Task 列表与详情使用可恢复、可分享的 URL，消除重复请求和竞态，并在移动端保留 execution status。
5. 将 Local Pi system runtime、Provider profile editing/availability 和 catalog metadata 明确分离，修复 create/edit 状态机。
6. 从 `models.dev` 建立可持久恢复的 Provider/Model Catalog，支持 startup due、手动同步和每日定时同步，第三方失败时继续服务 last-known-good snapshot。
7. 选择 provider/model 后自动填充来源可证明的 profile metadata，并清晰表达 base URL provenance/缺失状态；不得暗示 profile 已驱动真实 runtime。
8. 移除无法验证的全局 online/operational 断言，补齐 contract、store、API、UI、同步状态机、桌面和移动端回归验证。

## 现状缺口

| # | 缺口 | 类型 | 说明 | 建议补齐 |
|---|------|------|------|----------|
| 1 | 完整 session history 缺失 | 实现 / 依赖确认 | `ChatStore` 只有 create/get；API 无 list；Web 无 history。 | `/task-design` 固化 history item、cursor、title/preview、retention 与 URL 契约 |
| 2 | Session history 查询索引缺失 | 实现 | `chat_sessions` 有 `updated_at`，但无 `(tenant_id, updated_at, session_id)` keyset index。 | 设计 ordered migration 与 history indexes |
| 3 | Session title 不可辨识 | 实现 | 当前新 session 固定 title `Local Sage Chat`，完整 history 中不可区分。 | 设计首条 user text 派生 title 与 legacy 占位值处理 |
| 4 | Chat 会话连续性缺失 | 实现 | Chat nav 固定到 `/`，离开后返回静默创建新 session。 | URL canonical，跨 workspace 保留 session；stale session 显示恢复页 |
| 5 | Composer 键盘提示与行为冲突 | 实现 | UI 写明 Enter 发送，实际只换行，且未处理 IME composition。 | 实现 Enter/Shift+Enter/composition/重复提交契约 |
| 6 | Promotion capability 表达不足 | 依赖确认 | text event 只有 `messageId`，assistant CTA 会被后端 user-only 校验拒绝。 | additive optional `promotionEligibility`，历史 event fail-closed |
| 7 | Task detail/history 不进入 URL | 实现 | refresh、直接链接和 Back/Forward 无法恢复详情。 | 统一 `?view=tasks&task=<id>` 原生 link |
| 8 | Task 选择重复请求和竞态 | 实现 | article/button 双 handler 造成两组请求；快速切换可能旧响应覆盖新 URL。 | 单一 link + in-flight dedupe/abort/request token |
| 9 | 移动端隐藏 Task status | 实现 | `<700px` 隐藏 status badge，只剩 freshness。 | 390px 保留 Task ID、status、freshness |
| 10 | Provider 状态模型混乱 | 信息 / 实现 | editing、enabled、runtime-in-use 混用为 Active；Local Pi 可出现 Disabled 但仍运行。 | 三维状态和固定 system runtime |
| 11 | Provider create draft 被污染 | 实现 | sentinel activeId fallback 到首个 profile并覆盖空 draft。 | 显式 create/edit 状态机与 Cancel |
| 12 | Provider/Model Catalog 缺失 | 实现 / 资产 | 仓库无 catalog、外部 source adapter、projection API 或 selector。 | `/task-design` 定义 source、snapshot、read API 和 UI mapping |
| 13 | 手动/每日同步基础设施缺失 | 实现 / 配置 | API 无 scheduler、single-flight、ETag/LKG、attempt 状态、graceful shutdown。 | 设计 sync manager、DB state、advisory lock、retry 与 abort |
| 14 | `models.dev` base URL 覆盖不完整 | 信息 / 依赖确认 | native SDK provider 无 `api`，无法仅靠 upstream 满足所有 provider 的自动 base URL。 | 确认 source-only+manual 或另建 vetted overrides capability |
| 15 | Migration 机制需扩展 | 实现 / 依赖确认 | `ChatStore.migrate()` 当前只读取 `001_chat.sql`，无法自然运行 history/catalog 新 migration。 | task-design 固化 ordered migration runner 或等价升级策略 |
| 16 | 全局 health 不可置信 | 配置 / 实现 | shell 静态显示 `API + Worker online` / `All systems operational`。 | 改为中性 local/runtime 事实，不做本任务外的 health aggregation |
| 17 | 关键回归覆盖不足 | 资产 | 缺 history cursor、同步 200/304/LKG、IME、URL、Provider selector/create 和真实 390px smoke。 | 在 design/proposal 中形成分层测试矩阵 |

## 需求说明

### 已确认决策

1. 无 URL 且没有可用 history selection 时显示 landing，不自动创建 session；New Chat 显式创建。
2. 实现完整 session history，而非只保存一个 last-active ID。
3. Promotion 使用资源级 `promotionEligibility`，最终授权仍由服务器判定。
4. Task 使用原生 full-page URL link，不引入 React Router 或手写 popstate store。
5. Local Pi 是固定、只读表达的 system runtime，不能由普通 profile toggle 关闭。
6. shell 使用中性状态表达，不新增 API+Worker health aggregation。
7. Provider/Model Catalog source 使用官方 `https://models.dev/api.json`，支持 manual + daily sync。

### Session history 契约方向

- 裸 `/` 展示 landing + history；只有 New Chat 调用 `POST /v1/chat/sessions`。
- `session` query 是当前会话 canonical 状态；Chat/Tasks/Providers 链接保留它。URL session 404 或已删除时显示恢复页，不静默替换。
- “完整”指 retention 范围内尚存在的全部 session 可分页发现，不承诺无限保留或 transcript 全文检索。
- 推荐 `GET /v1/chat/sessions?limit=&cursor=&status=&q=` 返回 moderate enriched item：`sessionId/title?/status/preview?/lastMessageRole?/lastMessageAt?/createdAt/updatedAt/retentionEligibleAt`，不嵌入 full messages/runs/summaries。
- 排序使用 `(updated_at DESC, session_id DESC)` opaque keyset cursor；limit 默认 30、上限 100。默认 status=all；`q` v1 仅搜索 title。
- Preview 只取最新持久化 text 或安全 artifact label，禁止读取 artifact body。
- 第一条 persisted user text 在事务内为 null/placeholder title 派生可辨识标题；显式 title 不覆盖。closed session 只读，本任务默认不顺手新增 close/reopen/delete。
- History 必须 tenant-scoped；新增 session/status history indexes。Retention 继续遵守 `updated_at + 30 days` 后 eligible、实际删除由 operator job 决定的既有语义。

### Chat、Task 与 Workspace 约束

- 非 composition 状态下 Enter 提交一次并阻止换行，Shift+Enter 换行，`isComposing` 时 Enter 不提交，submitting 期间阻止重复 Enter/click。
- text timeline additive 增加可选 `promotionEligibility: 'explicit' | 'none'`；新 user event 为 `explicit`，assistant 为 `none`，历史缺字段按 `none`。
- Promotion payload 继续只允许既有 `mode/taskType/ruleId`，不得加入 actor、roles、provider、target、endpoint、namespace。
- Task row、Chat Task Card、direct URL 全部使用 `?view=tasks&task=<id>`；refresh、Back/Forward 结果一致，一次 activation 只加载一组 detail/events/artifacts。
- 390×844 下 Task row 至少显示 Task ID、execution status、projection freshness，无横向溢出。
- shell 只显示 `Local development mode`、`Runtime: Local Pi Harness` 等中性事实；Chat SSE 状态只描述当前 stream。

### Provider/Model Catalog 与同步约束

- 浏览器不得直接抓取 3.7MB `models.dev` payload；推荐由 API-side sync manager 抓取并持久化 last-known-good snapshot，浏览器只访问 Sage 的分页/搜索 projection API。
- Source URL 固定为 `https://models.dev/api.json`，不得由请求传入，避免 SSRF；仅发送公共 catalog fetch，不发送 profile、API key、Chat 内容或用户搜索词。
- Sync 支持 startup due、manual、daily。Daily 推荐每 24 小时加 deterministic jitter；API 长期停止后，若 no snapshot/stale，启动时后台补同步，不阻塞 `/readyz`。
- 使用 ETag/`If-None-Match`：304 只更新 checked/success/next-sync metadata，不复制 snapshot；200 经 bounded read、JSON parse、最小结构校验和原子激活。
- 建议 15–30s timeout、解压后 16MiB cap、有限 redirect；critical schema/parse/HTTP/DB 失败保留 active LKG，不部分激活。
- 多实例通过 PostgreSQL advisory lock + persisted `next_sync_at` single-flight；manual 在已有 running attempt 时复用该 attempt，避免重复下载。
- shutdown 停 scheduler、拒绝新 manual sync、abort fetch、标记本实例 attempt cancelled、释放 lock，再关闭 HTTP/store/pool。
- 外部 catalog 不参与 Sage `/readyz`；无 snapshot 时 Provider 页面显示 unavailable，有 LKG 时显示 stale/source/sync status。
- Ingest 对未知 upstream 字段容忍；对外只投影白名单字段，不把 raw 3.7MB JSON透传给浏览器。
- MIT source 需要在 docs/fixture/SBOM 中保留 attribution；CI 使用小型 fixture，不提交完整 upstream snapshot；live sync 只用于 opt-in smoke。

### Catalog 数据与 API 方向

推荐持久化成功 snapshot JSONB，而不是把 6,321 models 全量 normalized upsert：

- `provider_catalog_snapshots`：snapshot ID、source URL、ETag、content hash、raw JSONB、counts、fetched/activated time；保留 active + 前若干成功快照。
- `provider_catalog_state`：active snapshot、last checked/success、next sync、safe last error。
- `provider_catalog_sync_attempts`：trigger、status、HTTP/bytes、安全错误码、started/completed time。
- 每个 API 实例按 active snapshot 构建 immutable search projection；多实例 cache refresh 细节在 task-design 冻结。

建议 API：

- `GET /v1/provider-catalog/status`
- `GET /v1/provider-catalog/providers?q=&limit=&cursor=`
- `GET /v1/provider-catalog/models?providerId=&q=&status=&capability=&limit=&cursor=`
- `POST /v1/provider-catalog/sync` → 202 attempt
- `GET /v1/provider-catalog/sync/:attemptId`

Catalog read 需要 authenticated workspace principal；manual sync 使用独立 `provider-catalog-admin` capability/role，不能复用 `task-operator`。Local fixed principal 可显式拥有该 role，但不得据此声称已有 production auth。

### Provider profile 与自动填充

- Local Pi 独立显示为只读 **System runtime**；`models.dev` 内容属于 **Profile metadata catalog**。
- 新建/编辑 profile 使用 provider 和 model 两级可搜索 selector；model query 由 provider 约束，默认隐藏 deprecated，支持显式展开。
- 选择 provider 填 `providerId/providerName` 并清空旧 model；选择 model 填 `modelId/modelName`。
- `effectiveBaseUrl = model.provider.api ?? provider.api`。保存 `baseUrlSource='model'|'provider'|'manual'|'none'`、`catalogSnapshotId`、`catalogActiveSince`，使来源可解释。
- Profile display name 默认 `${providerName} / ${modelName}`，允许用户编辑。
- Catalog metadata 与 adapter/runtime kind 解耦；现有 `local|openai-compatible|anthropic` 不能用于推断 185 providers 的执行能力。
- 当 upstream 缺 base URL 时不得猜测。当前推荐 source-only + optional manual；若要自动补齐 OpenAI/Anthropic/Google 等，必须另行定义有 owner、version、source 和 review 的 Sage vetted overrides。
- API key 继续只进 `sessionStorage`，profile metadata 进 `localStorage`；catalog/provider/model 字段不得进入 Chat/Task request body，profile selection 不改变 `createLocalAgentClient()`/PiHarness。

### 涉及面

| 逻辑库 | 路径 | 角色 |
|--------|------|------|
| Sage 单仓 | `.` | 必须 |
| T0001 本地 runtime 任务记录 | `tasks/2026-08-13/T0001-local-application-runtime/` | 建议 |
| T0001 local application runtime OpenSpec | `openspec/changes/local-application-runtime/` | 建议 |
| 生产 Provider execution、生产身份与部署 | `platform/compose.yaml` | 排除 |

预计逻辑落点：

- Web：`platform/apps/agent-web/src/main.tsx`、`chat.tsx`、`tasks.tsx`、`providers.tsx`、`styles.css` 与 tests
- Chat contracts/store/API：`platform/packages/app-contracts/`、`platform/packages/chat-domain/`、`platform/apps/agent-api/`
- Database：chat history indexes、ordered migration mechanism、catalog snapshot/state/attempt migrations
- Catalog（新模块，最终路径待 design）：source client、snapshot store、sync manager、projection/search、API routes
- Runtime：`createApiRuntime()` 中 scheduler lifecycle、manual sync auth、graceful shutdown；不修改 Worker/Compose 语义
- OpenSpec：`openspec/changes/workspace-usability/` 已固化proposal/design、9个capability delta与51项实施任务

### 分支与依赖

- 工作分支：`fix-workspace-usability`
- 显式基线：`feat-local-application-runtime`
- 依赖：T0001 UI/runtime 尚未合入 `master`；T0001 delta specs 已于本次 proposal 通过 `openspec-sync-specs` 同步到主 specs（change 保持 active、未归档），使 T0002 能合法 `MODIFIED local-application-runtime`。
- OpenSpec 与实施/归档顺序：`local-application-runtime`（T0001）→ `workspace-usability`（T0002）；T0002 同时覆盖 T0001 在 `chat-user-interface` 与 `local-application-runtime` 中的 Fresh visit 自动建 session 行为。

## 工作上下文

| 仓库 | canonical 仓库路径 | 实际 checkout 路径 | worktree | 分支 | 基线 |
|------|--------------------|--------------------|----------|------|------|
| Sage 单仓 | `.` | `<worktree>` | 未使用（canonical checkout） | `fix-workspace-usability` | `feat-local-application-runtime` |

本任务实际写入 Sage 单仓；OpenSpec planning root 为 `<worktree>/openspec`。
### 关联 OpenSpec

| change | 路径 | 说明 |
|--------|------|------|
| `workspace-usability` | `openspec/changes/workspace-usability/` | 单一apply-ready change：4个NEW与5个MODIFIED capability，完整承接D1–D26 |

### 设计文档

| 文档 | 类型 | 归档落点 |
|------|------|----------|
| `design/README.md` | task design index | 随 task 归档保留；不单独晋升 |
| `design/session-history-and-navigation.md` | design | `docs/design/agent-application/session-history-and-navigation.md` |
| `design/provider-catalog-sync.md` | design | `docs/design/agent-application/provider-catalog-sync.md` |
| `design/provider-profile-catalog-ux.md` | design | `docs/design/agent-application/provider-profile-catalog-ux.md` |
| `design/workspace-interaction-contracts.md` | design | `docs/design/agent-application/workspace-interaction-contracts.md` |

## 方案笔记（openspec-explore，2026-08-14）

### 已冻结决策

| 决策 | 结论 |
|------|------|
| Fresh visit | landing + 显式 New Chat，不自动创建 |
| Session recovery | 完整 session history，不采用 last-active-only |
| Promotion | additive optional `promotionEligibility` |
| Task navigation | 原生 full-page URL link |
| Local Pi | 固定 system runtime |
| Workspace health | 中性 shell，不做 API+Worker 聚合 |
| Catalog source | 官方 `models.dev` API，manual + daily sync |
| Provider execution | 仍为 browser profile metadata，不驱动 PiHarness/runtime |

### 推荐架构

```text
models.dev/api.json
       │  ETag / timeout / size cap
       ▼
CatalogSyncManager (agent-api)
       │  advisory lock + persisted next_sync_at
       ▼
PostgreSQL active snapshot + attempts
       │  last-known-good / immutable projection
       ▼
Sage provider-catalog read APIs
       │  paginated provider/model search
       ▼
Provider profile editor (localStorage metadata)
       └─ API key remains sessionStorage

chat_sessions + latest safe message
       │  tenant keyset cursor
       ▼
GET /v1/chat/sessions
       │
       ▼
Landing/history → canonical ?session=<id>
```

### 建议 OpenSpec capability

| capability | 变更类型 | 核心场景 |
|------------|----------|----------|
| `chat-session-history` | NEW | landing、explicit New Chat、cursor history、tenant isolation、safe title/preview、retention、stale URL |
| `chat-user-interface` | MODIFIED | 覆盖 T0001 fresh visit、history UI、跨 workspace session、closed read-only、IME-safe composer |
| `chat-event-resumption` | MODIFIED | history/URL 恢复后 persisted events + latest-sequence SSE，不静默换 session |
| `chat-to-task-promotion` | MODIFIED | eligibility、历史 fail-closed、server auth/strict payload 不变 |
| `task-operations-interface` | MODIFIED | native Task URL、single activation、竞态防护、390px status+freshness |
| `provider-model-catalog` | NEW | startup/manual/daily、200/304、LKG、schema drift、lock/retry/shutdown、status/read/admin API |
| `browser-provider-profile-management` | NEW | system runtime 分离、catalog selector、profile v2/provenance、create/edit/Cancel、storage 边界 |
| `workspace-status-presentation` | NEW | 中性 shell、局部状态限定作用域 |

### 实施切片与验证

1. `/task-design` 冻结 history cursor/title/preview/retention/migrations 与 catalog snapshot/scheduler/auth/base URL policy。
2. Contracts + ordered migrations：SessionHistoryItem、catalog projection、history indexes、catalog tables。
3. Chat store/API + landing/history/session-preserving navigation。
4. Promotion、Composer、Task URL/竞态/移动端、shell 中性状态等已确认交互修复。
5. Catalog source client/store/sync manager/routes：200/304/LKG/lock/retry/shutdown/auth。
6. Provider profile v2 migration和 selector/autofill/provenance。
7. Targeted unit/contract/PostgreSQL/API/UI tests，typecheck/build，desktop + 390×844 browser smoke；live models.dev 仅 opt-in。

重点测试：history keyset 对未变化排序键不重复/不跳项；并发创建或更新到 cursor 之前的 session 通过首屏 refresh 收敛，不宣称跨请求 strict snapshot；tenant isolation；title transaction；sync 200/304/timeout/oversize/invalid JSON/schema drift/unknown fields/rollback/LKG；多实例 single-flight；shutdown abort；manual auth；provider/model debounce/abort/missing base URL；metadata/secret 分流；Chat/Task payload 不含 provider 字段。

## 设计决策状态

`task-design` 已将 explore 阶段 10 个推荐项全部收敛为 accepted decision：

1. Base URL 使用 **source-only + optional manual**；Sage vetted overrides 不在本任务。
2. Daily sync 为成功检查后 24 小时 + deterministic jitter；no-snapshot/stale startup 后台补同步。
3. Catalog 是 workspace-global public snapshot；profile 仍 browser-local。
4. History v1 仅title搜索；preview不参与搜索，不做transcript全文检索。
5. closed session只读；本任务不提供close/reopen/delete。
6. 对null与精确legacy占位title做保守回填；精确占位值因无provenance存在已记录的迁移例外。
7. Snapshot保留active + 前2个成功版本；state另记current active since。
8. deprecated/legacy model默认隐藏，可显式展开。
9. Manual sync使用独立`provider-catalog-admin`，local principal显式拥有。
10. 缺base URL的profile允许以`baseUrlSource='none'`保存disabled draft；URL adapter不完整时不得enabled。

完整决策D1–D26、方案权衡、接口、状态机、失败与迁移见`design/README.md`及四篇正文。`workspace-usability` proposal 已将其转成9个delta specs、30个requirements、118个scenarios和51项实施任务；当前无阻塞提案问题，下一步是 **`/task-apply T0002`**。

## 验收标准

- [x] 裸 `/` 展示 landing 和 retention 范围内完整 session history，不创建 session；New Chat 恰好创建一个 session并导航到 canonical URL。
- [x] History 通过 tenant-scoped keyset cursor 分页并按 updated time 排序；排序键未变化的记录不因 pagination 重复或跳项；并发创建/更新到 cursor 之前的记录通过刷新首屏收敛，且 UI 不宣称跨请求 strict snapshot；status/title filter、无损微秒 cursor 与 limit 校验严格。
- [x] History item 有安全 title/preview/last activity；不读取 Artifact body，不嵌入 transcript；stale/deleted URL 显示恢复页，closed session 只读。
- [x] 从已有 Chat 进入 Tasks/Providers 再返回，session ID 和 timeline 保持；URL、刷新、Back/Forward 一致。
- [x] Composer 支持 Enter、Shift+Enter、IME composition 和重复提交保护；assistant 不显示无效 Promote，eligible user promotion 保持严格 payload 和 server auth。
- [x] Task detail 使用 canonical URL；一次 activation 只加载一组详情请求；快速切换不被旧响应覆盖；390×844 可见 status + freshness。
- [x] Local Pi 只读显示为唯一system runtime；所有legacy `kind='local'`不迁移为外部profile；Provider profile清晰区分editing、enabled intent、derived availability与runtime，URL adapter缺合法base URL时拒绝enabled save但允许disabled draft，create/edit/Cancel无污染。
- [x] Sage API 可从 `models.dev` 完成 startup due、manual、daily sync；新内容200原子激活；same-hash/new-ETag 200只更新state validator；ETag 304不复制snapshot；A→B→A更新state activeSince；所有失败保留LKG且不影响`/readyz`。
- [x] Catalog sync 有timeout、decoded size cap、critical schema validation、unknown-field tolerance、fixed HTTPS source、bounded retry和safe error；每source至多一个queued/running attempt，bootstrap/claim/orphan/60s manual limit持久化，shutdown固定按manager closing/abort → Fastify close → manager settle/release → stores close。
- [x] Catalog read只服务DB active revision；cache mismatch同步重建，失败返回retryable 503而不返回旧revision；cursor绑定snapshot并在revision变化时409。
- [x] Provider/model read API 支持分页、搜索和筛选；Provider UI 可选择 185+/6,000+ 规模数据，不向浏览器传 raw snapshot。
- [x] 选择 provider/model 自动填充 provider/model ID 与名称；当 source 提供 API 时按 model override > provider API 填 base URL并记录 provenance；source 缺失时行为符合最终 design 决策。
- [x] API key 仅进入 `sessionStorage`，profile metadata 仅进入 `localStorage`；catalog/provider/model 字段不进入 Chat/Task payload，profile selection 不改变 Local PiHarness。
- [x] Manual sync 通过独立授权并防重复；catalog status 显示 source、counts、last checked/success、stale、attempt和安全错误码。
- [x] 保留 models.dev MIT attribution；deterministic CI 使用小 fixture，live API 只做 opt-in smoke。
- [x] contract/store/API/UI/sync tests、PostgreSQL integration、typecheck、build 全部通过；desktop 与 390×844 browser smoke 无 console error。

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-14 | 创建 T0002；汇总 engineer、product、design/usability 三轮 review，记录初始缺口、范围和验收标准 |
| 2026-08-14 | 首轮 openspec-explore：推荐 URL/session、promotionEligibility、Task URL、Provider 状态机与中性 health；状态进入 exploring |
| 2026-08-14 | 用户确认首访、promotion、Task URL、Local Pi、health 决策；将 session 范围升级为完整 history，并新增 models.dev Provider/Model Catalog manual+daily sync 与自动填充需求；第二轮 explore 推荐 API-side persisted snapshot，下一步改为必须 task-design |
| 2026-08-14 | 完成task-design：暂存4篇设计正文与索引，冻结D1–D26；两轮独立审查修正cursor并发/微秒精度、Catalog validator/cache/attempt/activeSince/shutdown和profile migration语义；下一步 `/task-propose T0002` |
| 2026-08-14 | 完成task-propose：先将T0001已批准delta同步到主spec以建立依赖基线，再创建`workspace-usability`单一change；最终含9个delta、30 requirements、118 scenarios与51项tasks，strict validate和独立审查均通过；下一步 `/task-apply T0002` |
