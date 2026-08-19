# Chat session history 与导航设计

> 以 PostgreSQL 为权威提供 retention 范围内完整、可分页的 session history；Fresh visit 不再自动建 session，用户通过 landing/history 显式打开或创建会话，URL 始终是当前 session 的 canonical 状态。

## Context

- **Problem**：`ChatStore` 只有 create/get，Web 无 history；`main.tsx` 在无 query 时创建固定标题 `Local Sage Chat`，跨 Workspace 返回会丢失上下文。
- **Stakeholders**：本地 Workspace 用户、Chat API/Web 维护者、后续 retention operator。
- **Success criteria**：所有尚存在 session 可发现；New Chat 恰好创建一次；stale URL 不被静默替换；title/preview 可辨识且不泄露 Artifact body。
- **Constraints**：保留 `updated_at + retention_days` 的既有 P3 语义；当前 `updated_at` 在 user message 与 assistant completion 时都会变化；不引入 Router。
- **Out of scope**：transcript 全文检索、session delete/close/reopen/rename、实际 retention deletion job、跨设备 browser preference sync。

## Current State

- `chat_sessions` 已有 `tenant_id/session_id/status/title/created_at/updated_at/retention_days`，主键为 `(tenant_id, session_id)`。
- `acceptUserMessage()` 与 `completeRun()` 事务内更新 `updated_at`；可直接表达最近活动。
- `ChatStore.migrate()` 只执行 `001_chat.sql`；新增 `002` 不会自动运行。
- `GET /v1/chat/sessions/:sessionId` 返回 session/messages/runs/summaries，尚无 list route。
- T0001 `Fresh local Web visit` 要求自动创建 session；T0002 proposal 必须显式修改它。

## Options Considered

| Option | Cost | Risk | Reversibility | Time | Complexity |
|--------|------|------|---------------|------|------------|
| A. last-active browser ID | 低 | 高：只能恢复一个、浏览器状态漂移 | 高 | 短 | 低 |
| B. DB list 返回裸 `Session` + offset | 中 | 中：无 preview、并发 offset 漂移 | 高 | 中 | 低 |
| C. DB enriched item + keyset cursor | 中 | 低：契约明确、查询有界 | 高 | 中 | 中 |
| D. stateful MVCC snapshot pagination | 高 | 中：跨请求 snapshot/lease 运维复杂 | 低 | 长 | 高 |

**推荐：方案 C。** 它满足可辨识 history 与有界查询，不引入 stateful pagination 服务。

接受的取舍：`updated_at` 是可变排序键，因此 continuation 不是跨请求严格 snapshot。稳定数据集不会因 offset 漂移重复/跳项；并发新建或更新到 cursor 之前的 item 在当前 continuation 中不强制出现，用户刷新首屏后收敛。若未来必须严格 snapshot，应另立方案 D，而不能宣称普通 keyset 已满足。

回退计划：UI 可暂时只读取第一页；新增 list API、索引和 title 数据仍向后兼容，既有 session detail/SSE 不变。

## Recommended Approach

### 产品语义

1. 裸 `/` 渲染 Chat landing 与 history，不发 `POST /v1/chat/sessions`。
2. New Chat 成功后导航到 `/?session=<id>`；失败留在 landing 并显示 retryable error。
3. History item 使用 native link 打开；Tasks/Providers URL 保留 `session`。
4. `session` 404/已被 retention job 删除时显示 recovery state（history + New Chat），不得自动创建替代 session。
5. `open` 可发送；`closed` 只读。打开 retained closed session 不等于 reopen。
6. “完整 history”指所有尚存在 session 都能通过分页发现；不承诺已删除记录或全文搜索。

## Architecture

```text
┌──────────────────────── Browser ────────────────────────┐
│ Chat landing/history ──native href──> ?session=<id>     │
│       │ GET list                         │ GET detail    │
│       │                                  │ events + SSE  │
└───────┼──────────────────────────────────┼───────────────┘
        ▼                                  ▼
┌──────────────────── agent-api Chat routes ──────────────┐
│ strict query/cursor decode │ stale session -> 404       │
└───────────────┬────────────┴──────────────┬──────────────┘
                ▼                           ▼
       ChatStore.listSessions()     existing timeline APIs
                │
                ▼
┌──────────────────── PostgreSQL ──────────────────────────┐
│ chat_sessions keyset page                               │
│   └─ LATERAL latest message/part preview                │
│ ordered migration ledger + history indexes              │
└──────────────────────────────────────────────────────────┘
```

### Component responsibilities

- **Contracts**：定义 history request/response、item、cursor error；保持 `Session.v1` 不变。
- **ChatStore**：tenant-scoped keyset page、latest safe preview、事务内 title derivation。
- **Chat API**：严格 query schema、limit、cursor/filter binding、错误映射。
- **Web**：landing、history state、explicit create、stale/closed presentation、session-preserving links。
- **Migration runner**：有序执行不可变 SQL migration，记录 version/checksum。

## Interfaces

### History contract

```ts
type SessionHistoryStatus = 'all' | 'open' | 'closed';

type SessionHistoryItem = {
  schemaVersion: '1';
  sessionId: string;
  status: 'open' | 'closed';
  title?: string;
  preview?: string;
  lastMessageRole?: 'user' | 'assistant';
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
  retentionEligibleAt: string;
};

type ListSessionsResponse = {
  schemaVersion: '1';
  items: SessionHistoryItem[];
  nextCursor?: string;
};
```

`retentionEligibleAt = updated_at + retention_days` 仅表示 operator job 可删除的最早时间，不是 guaranteed deletion time。

### HTTP

```http
GET /v1/chat/sessions?limit=30&cursor=<opaque>&status=all&q=<title>
200 ListSessionsResponse
```

- `limit` 默认 30，范围 1–100。
- `status` 默认 `all`。
- `q` trim 后最大 100 code points，按 title case-insensitive literal contains；`%`/`_` 必须转义为普通字符。
- cursor 是 base64url 编码的 versioned internal token：`{v,sortTime,sessionId,filterHash}`。`sortTime` 必须来自 PostgreSQL 为 `updated_at` 生成的 UTC 六位微秒规范文本（例如 `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`），查询时以 `$cursor_time::timestamptz` 比较；不得使用 JavaScript `Date.toISOString()` 的毫秒值回填 cursor。Response 的公开 `updatedAt` 仍可按现有 date-time contract 输出，但 cursor 单独携带无损内部排序值。它是 opaque continuation，不是授权凭据。
- cursor version/时间/ID/filterHash 非法或与当前 normalized filter 不一致 → 400 `CHAT_INVALID_REQUEST`。
- page query 多取 1 条确定 `nextCursor`，response 不返回内部 token 字段。

### Keyset query

排序与 continuation：

```sql
ORDER BY s.updated_at DESC, s.session_id DESC

WHERE s.tenant_id = $tenant
  AND ($status = 'all' OR s.status = $status)
  AND ($q IS NULL OR s.title ILIKE $escaped_q ESCAPE '\\')
  AND (
    $cursor_time IS NULL
    OR s.updated_at < $cursor_time
    OR (s.updated_at = $cursor_time AND s.session_id < $cursor_id)
  )
LIMIT $limit_plus_one
```

先限定 session page，再对页内 row 做 `LEFT JOIN LATERAL` 获取 latest persisted message 与一个可展示 part，禁止扫描/聚合整份 transcript。建议索引：

```sql
CREATE INDEX ... ON chat_sessions
  (tenant_id, updated_at DESC, session_id DESC);
CREATE INDEX ... ON chat_sessions
  (tenant_id, status, updated_at DESC, session_id DESC);
```

当前 local + 30-day 规模下 title contains 不强制 `pg_trgm`；出现实际慢查询证据后再加。

## Title and preview policy

### Title

首条 user message 与 message/run/event 一起在同一事务中处理：

1. 找第一个非空 text part；Unicode whitespace 压缩为单空格并 trim。
2. 按 code point 截断 80；Contract 仍允许显式 title 最大 200。
3. artifact-only first message 使用不含 artifact body 的 `Artifact conversation`。
4. 仅在 `chat_sessions.title IS NULL` 时写入；显式 title永不覆盖。

Legacy migration：运行时title派生仍只处理`title IS NULL`，因此新建时显式title永不覆盖。一次性migration可对`title IS NULL`或精确等于`Local Sage Chat`的已有session，使用首条persisted user text做幂等保守回填；无可用text时保留原值，不读取Artifact body。由于旧schema没有title provenance，对精确占位值的处理是一个明确接受的数据迁移例外：依据是当前Web统一自动写入该字符串，但极少数外部调用者若曾显式使用同名title也可能被回填。Proposal必须记录该trade-off和集成测试；未来显式提交同名title不受运行时派生影响。

### Preview

- 取最新 message；优先其第一个非空 text part，压缩 whitespace并截断 160 code points。
- message 无 text 时返回 `[Artifact: <sanitized name>]`；只读 reference metadata，不获取 Artifact 内容。
- 无 message 时不返回 preview/role/time。
- Preview 不参与 v1 search。

## State Management and consistency

```text
landing --New Chat 201--> open session URL
landing --history link--> retained open/closed session URL
session URL --404-------> recovery state
open session --message-> updated_at moves session to first-page order
closed session----------> read-only; no transition in T0002
```

- PostgreSQL 是 session/history 权威；`localStorage` 不决定当前 session 是否存在。
- 同一 request 内 list query 使用 PostgreSQL statement snapshot。
- 跨 page request 使用 continuation consistency：排序键未改变的 row 不会重复；并发活跃 row 可移到前页，刷新第一页后可见。
- Web 在显式 New Chat 后 read-your-writes；列表可 optimistic prepend 或重新加载第一页，不能伪造未持久化 session。

## Ordered migration design

不修改已发布 `001_chat.sql`。新增共享 migration ledger：

```sql
sage_schema_migrations(
  component text,
  version text,
  checksum_sha256 text,
  applied_at timestamptz,
  PRIMARY KEY(component, version)
)
```

Runner 对显式排序 manifest（如 `chat: 001,002`）执行：

1. 使用 dedicated connection 取得 component advisory lock。
2. 确保 ledger 存在；读取 applied versions。
3. 已应用 version 的 checksum 不一致则 fail fast；禁止静默重写历史 migration。
4. 对 pending file 执行并记录 checksum；migration 必须幂等，以承受“SQL提交后、ledger写入前”崩溃重试。
5. release lock。Runtime 外层 migration lock 可保留，store runner仍能保护 tests/Worker等独立入口。

`002_chat_history.sql` 负责 indexes 与 legacy title backfill。Catalog 使用独立 component/version，共享 runner，不把两者塞进 Chat migration。

## Failure Modes

| Failure | Likelihood | Impact | Mitigation |
|---------|------------|--------|------------|
| 非法/篡改 cursor | 中 | 当前 list request | 严格 decode/filterHash，400，不执行动态 SQL |
| 并发更新移动未读 row | 中 | 当前 continuation暂不可见 | 明确一致性边界；UI refresh first page；不虚假承诺 snapshot |
| session 被 retention job 删除 | 低 | stale URL | 404 recovery state，不自动建新 session |
| preview 包含大文本/Artifact body | 中 | 性能/泄露 | SQL先限页；code-point截断；只读 reference metadata |
| title backfill 覆盖显式标题 | 低 | UX | 只处理 null/精确 legacy placeholder；migration幂等 |
| migration checksum drift | 低 | startup blocked | fail fast并要求新 migration，不覆盖历史 |
| closed session仍提交 | 低 | 写入错误 | Store `status='open'` 条件保持权威；UI禁用只是辅助 |

## Rollout / Migration

1. **Contracts/runner**：新增 history contracts 与 migration runner tests；先让现有 `001` 被登记。
2. **DB/store**：应用 `002` indexes/backfill，交付 list/title/preview integration tests。
3. **API**：增加 list route/strict query；既有 POST/detail/events/SSE 保持兼容。
4. **Web**：先 landing/history，再删除 `ensureChatSession()`；所有 workspace links 使用统一 URL builder。
5. **Spec**：T0002 delta 显式替换 T0001 Fresh visit auto-create scenario。

回滚 Web 时 list API/DB变更可保留；回滚 DB不删除已生成 title或索引，避免破坏数据。

## Verification

- Contract：limit/status/q/cursor additionalProperties 与 filter binding。
- PostgreSQL：tenant isolation、open/closed、同timestamp tie-break、同毫秒不同微秒cursor round-trip、latest preview、artifact-only、title事务、legacy backfill、checksum drift。
- Concurrency：稳定 key不重复；并发 create/update 被明确定义为首屏refresh可见，而非伪造 strict snapshot assertion。
- API/UI：landing不POST、New Chat一次POST、404 recovery、closed composer disabled、session-preserving native links。
- Browser：desktop与390×844，history load-more/refresh/back-forward，无 console error。

## Open Questions

无阻塞问题。若产品未来要求跨 page 严格 snapshot，需要单独评估 stateful cursor/MVCC snapshot或不可变history index，不能在本实现中追加隐式承诺。

## Cross-References

- [`provider-catalog-sync.md`](./provider-catalog-sync.md)
- [`workspace-interaction-contracts.md`](./workspace-interaction-contracts.md)
- P3 retention：`platform/docs/p3-entry-decisions.md`
- 下游：`/task-propose T0002`
