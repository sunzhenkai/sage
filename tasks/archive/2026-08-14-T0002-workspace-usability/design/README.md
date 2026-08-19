# T0002 Workspace usability 设计索引

> 本目录把完整 Chat session history、`models.dev` Catalog 同步、Provider profile UX 与 Workspace 交互约束固化为 task 内设计；当前不写业务代码、OpenSpec、`docs/design`、ADR 或 knowledge。

## 设计状态

- Task：`T0002 — workspace-usability`
- 分支：`fix-workspace-usability`
- 阶段：`task-design`
- 设计日期：2026-08-14
- 下游：`/task-propose T0002`

## 文档索引

| 文档 | 角色 | 核心决策 |
|------|------|----------|
| [`session-history-and-navigation.md`](./session-history-and-navigation.md) | Chat history/API/DB/URL 主设计 | enriched keyset history、显式 New Chat、安全 title/preview、retention 与 continuation consistency |
| [`provider-catalog-sync.md`](./provider-catalog-sync.md) | Catalog 数据与同步主设计 | API-side persisted JSONB snapshot、ETag/LKG、global state、single-flight、manual/daily/startup |
| [`provider-profile-catalog-ux.md`](./provider-profile-catalog-ux.md) | Provider profile 与 selector 设计 | system runtime 分离、profile v2、catalog-assisted autofill、source-only + manual base URL |
| [`workspace-interaction-contracts.md`](./workspace-interaction-contracts.md) | 跨 Workspace 交互不变量 | native URL、promotionEligibility、IME-safe composer、Task竞态、移动端与中性状态 |

## 决策登记

| ID | 决策 | 状态 |
|----|------|------|
| D1 | Fresh visit 显示 landing/history；只有显式 New Chat 创建 session | accepted |
| D2 | History 返回 moderate enriched item，不嵌入 transcript/runs/message count | accepted |
| D3 | History 使用 `(updated_at DESC, session_id DESC)` opaque keyset cursor；并发更新通过首屏刷新收敛，不承诺跨请求严格 snapshot | accepted |
| D4 | v1 search 仅 title；closed session 只读，本任务不新增 close/reopen/delete | accepted |
| D5 | 首条 persisted user message 事务内派生 title；对 null 与旧精确占位 title 做保守迁移 | accepted |
| D6 | 引入带 component/version/checksum ledger 的 ordered PostgreSQL migration runner；不修改已发布 migration | accepted |
| D7 | Catalog 使用 API-side PostgreSQL persisted snapshot，不采用 browser-direct 或 memory-only | accepted |
| D8 | Catalog 是 workspace-global public metadata snapshot；profile 仍 browser-local | accepted |
| D9 | Catalog 保存 raw tolerant JSONB，向外只提供 active snapshot 的白名单 immutable projection | accepted |
| D10 | Daily = 成功检查后 24h + deterministic jitter；no-snapshot/stale startup 后台补同步 | accepted |
| D11 | Catalog 保留 active + 前 2 个成功 snapshot；304 不创建 snapshot | accepted |
| D12 | Manual sync 使用独立 `provider-catalog-admin`；local principal 显式拥有 | accepted |
| D13 | Base URL 使用 `model.provider.api ?? provider.api`；source 缺失时允许 manual，不维护 Sage overrides | accepted |
| D14 | Local Pi 从 profile list 移出，作为不可关闭的 System runtime；catalog metadata 不驱动 runtime | accepted |
| D15 | Provider profile v2 不持久化 API key 或 `apiKeyConfigured`；session secret 状态只由 `sessionStorage` 派生 | accepted |
| D16 | Task navigation 采用 native full-page URL link；不引入 Router | accepted |
| D17 | Promotion 使用可选资源级 `promotionEligibility`，历史缺失 fail-closed | accepted |
| D18 | shell 只呈现中性事实，不聚合或猜测 API+Worker health | accepted |
| D19 | History cursor使用PostgreSQL无损微秒排序值，不以JavaScript毫秒时间生成cursor | accepted |
| D20 | Catalog当前validator ETag存于state；同内容新ETag的200不复制snapshot但更新validator | accepted |
| D21 | Catalog read只服务与DB active revision一致的projection；cache mismatch同步重建，失败返回retryable 503，不返回旧revision | accepted |
| D22 | 每个source在DB中最多一个queued/running attempt；bootstrap、claim、orphan recovery和manual 60s限流均持久化 | accepted |
| D23 | Shutdown顺序固定为manager closing/abort → Fastify close → manager settle/release → 其余stores close | accepted |
| D24 | Profile `enabled`是用户意图；URL adapter缺合法base URL时拒绝enabled save，但允许disabled draft | accepted |
| D25 | 所有legacy `kind='local'`均不迁移为外部profile；Local Pi仅由System runtime呈现 | accepted |
| D26 | Snapshot row记录首次激活；state `active_activated_at`记录当前pointer active since，A→B→A时更新 | accepted |

## 跨文档不变量

1. Provider/catalog/target/actor/roles 不得加入 Chat submit、promotion 或 Task create/control payload。
2. Catalog 只属于 Agent Application；Agent Library、PiHarness、Temporal Workflow 不依赖 `models.dev`。
3. API key、OAuth token 等 secret 不进入 PostgreSQL catalog、`localStorage`、日志或 sync request。
4. 外部 Catalog 故障不影响 `/livez` 或 `/readyz`；无 snapshot 才显示 catalog unavailable，有 LKG 则继续读。
5. Session history 的“完整”仅指 retention 范围内尚存在记录可分页发现，不表示无限保留、全文检索或精确删除时间。
6. T0002 proposal 必须显式覆盖 T0001 的 Fresh local Web visit 自动建 session scenario。

## 归档落点表

以下路径只在 `task-archive` 晋升；本阶段不得写入。

| 当前文档 | 类型 | 目标仓 | 计划归档落点 |
|----------|------|--------|----------------|
| `design/session-history-and-navigation.md` | design | `.` | `docs/design/agent-application/session-history-and-navigation.md` |
| `design/provider-catalog-sync.md` | design | `.` | `docs/design/agent-application/provider-catalog-sync.md` |
| `design/provider-profile-catalog-ux.md` | design | `.` | `docs/design/agent-application/provider-profile-catalog-ux.md` |
| `design/workspace-interaction-contracts.md` | design | `.` | `docs/design/agent-application/workspace-interaction-contracts.md` |

归档时还需更新 `docs/design/README.md` 文档列表；目前不单独创建 ADR，方案权衡与决策登记由上述设计承载。

## Proposal 交接清单

- NEW：`chat-session-history`
- MODIFIED：`chat-user-interface`、`chat-event-resumption`、`chat-to-task-promotion`、`task-operations-interface`
- NEW：`provider-model-catalog`、`browser-provider-profile-management`、`workspace-status-presentation`
- Proposal/spec 必须把 D1–D26 转成可验证 SHALL/scenario；不得把本文的 implementation sketch 直接当成已实现事实。
- `chat-session-history`必须覆盖D19：同毫秒不同微秒cursor round-trip，以及continuation consistency/first-page refresh语义。
- `provider-model-catalog`必须覆盖D20–D23、D26：same-hash/new-ETag、DB active-only projection、queued/running唯一claim/orphan、60s manual limit、唯一shutdown顺序、A→B→A activeSince。
- `browser-provider-profile-management`必须覆盖D24–D25：enabled intent与URL shape、disabled draft、所有legacy local隔离。
- OpenSpec task 顺序应先 contracts/migrations，再 store/API，再 UI/sync/profile，最后集成与 browser smoke。

## 未决问题

无阻塞设计问题。以下属于 proposal/implementation 参数，不改变架构：最终 UI copy、jitter 的固定分钟范围、具体 package 名称、safe error code 完整枚举。默认值已在各主设计中给出。

## 交接

**已设计**：完整Chat session history、`models.dev` persisted Catalog、Provider profile v2与跨Workspace交互契约，决策D1–D26均已接受。

**暂存位置**：`tasks/2026-08-14/T0002-workspace-usability/design/`

**归档落点（尚未写入）**：

- `docs/design/agent-application/session-history-and-navigation.md`
- `docs/design/agent-application/provider-catalog-sync.md`
- `docs/design/agent-application/provider-profile-catalog-ux.md`
- `docs/design/agent-application/workspace-interaction-contracts.md`

**下一步**：`/task-propose T0002`

**未决问题**：无阻塞项；仅剩不改变架构的copy、package命名与safe error枚举细节。
