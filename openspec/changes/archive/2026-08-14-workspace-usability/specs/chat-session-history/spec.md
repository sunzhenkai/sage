## ADDED Requirements

### Requirement: 显式创建与可恢复的 Session history
系统 SHALL 在裸 `/` 展示 landing 与 retention 范围内仍存在的 session history，且 SHALL 只在用户显式执行 New Chat 时调用 `POST /v1/chat/sessions`。当前 session SHALL 由 canonical `session` query 表达；不存在或已删除的 session SHALL 显示 recovery state，不得静默创建或替换 session。

#### Scenario: Fresh local Web visit 不自动创建 session
- **WHEN** 用户打开不含 `session` query 的本地 Web URL
- **THEN** Web 展示 landing 与 history，且不发送创建 session 的请求

#### Scenario: 显式 New Chat
- **WHEN** 用户在 landing 执行 New Chat 且创建成功
- **THEN** 系统恰好创建一个 session，并导航到含返回 id 的 canonical URL

#### Scenario: Stale session URL
- **WHEN** canonical URL 指向不存在或已被 retention job 删除的 session
- **THEN** Web 展示 history、New Chat 与可恢复错误，且不创建替代 session

#### Scenario: Closed session 保持只读
- **WHEN** 用户打开 retention 范围内的 closed session
- **THEN** 系统展示其历史内容但禁止发送新消息，且不提供隐式 reopen

### Requirement: Tenant-scoped enriched history API
系统 SHALL 提供 tenant-scoped `GET /v1/chat/sessions`，返回 moderate enriched item：`sessionId`、`status`、可选 `title`、可选 `preview`、可选 `lastMessageRole`、可选 `lastMessageAt`、`createdAt`、`updatedAt`、`retentionEligibleAt`；response SHALL NOT 嵌入 transcript、runs、summaries 或 message count。`limit` SHALL 默认 30 且范围为 1–100，`status` SHALL 支持 `all|open|closed`，`q` SHALL 最多 100 code points且仅按 title 做 case-insensitive literal contains，所有 query schema SHALL 拒绝额外字段。

#### Scenario: History tenant isolation
- **WHEN** authenticated principal 请求 session history
- **THEN** API 只返回其 tenant 的 session，且其他 tenant 的记录不会影响页面与 cursor

#### Scenario: 严格筛选与分页参数
- **WHEN** client 提供非法 `limit`、`status`、`q`、cursor 或额外 query 字段
- **THEN** API 返回 400 `CHAT_INVALID_REQUEST`，且不执行宽松或动态 SQL

#### Scenario: Retention 语义
- **WHEN** history item 被返回
- **THEN** `retentionEligibleAt` 等于 `updated_at + retention_days` 并只表示 operator job 最早可删除时间，而不表示 guaranteed deletion time

#### Scenario: 完整性的范围
- **WHEN** 用户持续请求有效 `nextCursor` 直到末页
- **THEN** 所有 retention 范围内仍存在且匹配筛选的 session 均可被发现，但已删除记录和 transcript 全文检索不属于该承诺

### Requirement: 无损 keyset continuation consistency
History SHALL 按 `(updated_at DESC, session_id DESC)` 排序，并使用包含 version、PostgreSQL UTC 六位微秒 `sortTime`、`sessionId` 与 `filterHash` 的 opaque base64url cursor。Cursor 的时间 SHALL 直接由 PostgreSQL 无损排序值产生并以 `timestamptz` 比较，不得由 JavaScript 毫秒时间重建。分页 SHALL 提供 continuation consistency：排序键未变化的记录不得重复或跳项；并发 create/update 移到 cursor 之前的记录 SHALL 通过刷新首屏收敛，系统不得宣称跨请求 strict snapshot。

#### Scenario: 同一毫秒内不同微秒
- **WHEN** 两个 session 的 `updated_at` 位于同一毫秒但具有不同 PostgreSQL 微秒值并跨越分页边界
- **THEN** cursor round-trip 保留六位微秒精度，两个 session 均恰好出现一次

#### Scenario: 相同 timestamp 使用 id 打破平局
- **WHEN** 多个 session 具有完全相同的 `updated_at`
- **THEN** API 使用 `session_id DESC` 稳定排序并生成无重复、无跳项的 continuation

#### Scenario: Cursor 与 filter 绑定
- **WHEN** client 将某一 normalized `status/q` 的 cursor 用于不同筛选
- **THEN** API 返回 400 `CHAT_INVALID_REQUEST`

#### Scenario: 并发活跃记录的收敛
- **WHEN** continuation 期间 session 被创建或更新并移动到当前 cursor 之前
- **THEN**当前 continuation 不保证返回该记录，刷新第一页后 SHALL 返回它，UI 不得将此行为描述为 strict snapshot

### Requirement: 安全且可辨识的 title 与 preview
Workspace显式New Chat调用`POST /v1/chat/sessions`时，Web request body SHALL省略`title`且API/store SHALL以SQL `NULL` title创建session，不得发送或注入占位title。首条persisted user message SHALL在message/run/event的同一事务中为`NULL` title派生最多80 code points的标题，且不得覆盖显式title。History preview SHALL只使用最新persisted message的首个非空text或sanitized artifact label，最多160 code points；SHALL NOT读取Artifact body。Preview SHALL NOT参与v1 search。

#### Scenario: 首条 user text 派生标题
- **WHEN** open session 的首条 persisted user message 含有非空 text且 title 为 `NULL`
- **THEN**事务提交时 title 使用 whitespace-normalized、code-point-safe 截断文本，message 与 title 原子可见

#### Scenario: Workspace New Chat 以 NULL title 创建
- **WHEN**用户在Workspace显式执行New Chat
- **THEN**Web发送的POST body不含`title`字段，API/store创建`title IS NULL`的session，且首条persisted user text提交前不写入`Local Sage Chat`或其他占位值

#### Scenario: 显式 title 不被覆盖
- **WHEN**session由未来API client显式设置title，包括显式设置为`Local Sage Chat`，随后持久化首条user text
- **THEN**runtime title derivation保留该title；只有一次性legacy migration可处理迁移前已存在的精确占位值

#### Scenario: Artifact-only 内容
- **WHEN**首条 message 或最新 message 只有 Artifact reference
- **THEN** title/preview 只使用安全的 `Artifact conversation` 或 `[Artifact: <sanitized name>]` label，不读取 artifact content

#### Scenario: Legacy 占位标题回填
- **WHEN**一次性 migration 遇到 `NULL` 或精确 `Local Sage Chat` 的 legacy title并存在首条 persisted user text
- **THEN** migration 幂等回填安全标题；其他显式 title与无可用文本的记录保持不变

### Requirement: Ordered PostgreSQL migration ledger
系统 SHALL 使用 `sage_schema_migrations(component, version, checksum_sha256, applied_at)` 和显式排序 manifest 执行 component-scoped migration。Runner SHALL 使用 dedicated connection 与 advisory lock，按顺序执行 pending migration并记录 checksum；已应用 version checksum变化 SHALL fail fast，已发布 migration SHALL NOT 被静默重写。

#### Scenario: 有序应用 Chat history migration
- **WHEN** Chat store 在只登记既有 `001` 的数据库上启动
- **THEN** runner 按 manifest 应用 history indexes与legacy title backfill migration，并将其 version/checksum写入ledger

#### Scenario: Migration checksum drift
- **WHEN**已应用 migration 文件的 checksum 与 ledger 不一致
- **THEN** startup fail fast并要求新增 migration，不继续运行或改写历史 ledger

#### Scenario: 独立 component 并发 migration
- **WHEN** Chat 与 Provider Catalog 从不同入口并发执行 migration
- **THEN**每个 component 按自身 manifest和advisory lock有序推进，共享 ledger但不把 Catalog migration塞入Chat component
