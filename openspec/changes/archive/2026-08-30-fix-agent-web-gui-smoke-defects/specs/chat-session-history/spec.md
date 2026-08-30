## MODIFIED Requirements

### Requirement: Tenant-scoped enriched history API
系统 SHALL 提供 tenant-scoped `GET /v1/chat/sessions`，返回 moderate enriched item：`sessionId`、`status`、可选 `title`、可选 `preview`、可选 `lastMessageRole`、可选 `lastMessageAt`、可选 `archivedAt`、`createdAt`、`updatedAt`、`retentionEligibleAt`；response SHALL NOT 嵌入 transcript、runs、summaries 或 message count。`limit` SHALL 默认 30 且范围为 1–100，`status` SHALL 支持 `all|open|closed`，`q` SHALL 最多 100 code points且按 effective title 做 case-insensitive literal contains——effective title 为存储 `title`，`title IS NULL` 时回退为该 session 在当前 locale 下的默认显示标题（en 为 `Untitled Chat`，zh-CN 为 `未命名对话`），使搜索词与列表展示的兜底标题一致，`archived` SHALL 仅接受 `true|false` 且缺省为 `false`，所有 query schema SHALL 拒绝额外字段。缺省与 `archived=false` SHALL 只返回 `archived_at IS NULL` 的 session；`archived=true` SHALL 只返回已归档 session；`archived` SHALL 与 `status` 正交组合并参与 cursor 的 normalized filter 绑定。

#### Scenario: History tenant isolation
- **WHEN** authenticated principal 请求 session history
- **THEN** API 只返回其 tenant 的 session，且其他 tenant 的记录不会影响页面与 cursor

#### Scenario: 严格筛选与分页参数
- **WHEN** client 提供非法 `limit`、`status`、`q`、`archived`、cursor 或额外 query 字段
- **THEN** API 返回 400 `CHAT_INVALID_REQUEST`，且不执行宽松或动态 SQL

#### Scenario: 归档视图过滤
- **WHEN** client 分别以缺省参数与 `archived=true` 请求 session history
- **THEN** 缺省与 `archived=false` 只返回未归档 session，`archived=true` 只返回已归档 session 且其 item 含 `archivedAt`，同一 session 不会同时出现在两个视图

#### Scenario: 归档维度参与 cursor 绑定
- **WHEN** client 将未归档视图的 cursor 用于 `archived=true` 请求（或反向）
- **THEN** API 返回 400 `CHAT_INVALID_REQUEST`

#### Scenario: Retention 语义
- **WHEN** history item 被返回
- **THEN** `retentionEligibleAt` 等于 `updated_at + retention_days` 并只表示 operator job 最早可删除时间，而不表示 guaranteed deletion time

#### Scenario: 完整性的范围
- **WHEN** 用户持续请求有效 `nextCursor` 直到末页
- **THEN** 所有 retention 范围内仍存在、未彻底删除且匹配筛选（含归档维度）的 session 均可被发现，但已删除记录和 transcript 全文检索不属于该承诺

#### Scenario: 搜索命中未命名会话的默认标题
- **WHEN** `title IS NULL` 的 session 以 `Untitled Chat` 展示，client 以 `q=Untitled` 请求 history
- **THEN** 该 session 出现在结果中，且 locale 为 zh-CN 时 `q=未命名对话` 同样命中、`q=Untitled` 不命中

#### Scenario: 有 title 的会话不受回退影响
- **WHEN** session 存储了显式或派生 title，client 以该 title 的子串搜索
- **THEN** 匹配行为与回退引入前一致，不额外匹配默认标题

### Requirement: 安全且可辨识的 title 与 preview
Workspace显式New Chat调用`POST /v1/chat/sessions`时，Web request body SHALL省略`title`且API/store SHALL以SQL `NULL` title创建session，不得发送或注入占位title。首条persisted user message SHALL在message/run/event的同一事务中为`NULL` title派生最多80 code points的标题，且不得覆盖显式title。History preview SHALL只使用最新persisted message的首个非空text或sanitized artifact label，且在归一化与截断前 SHALL 剔除该 text 中的 `<think>…</think>` 推理区间（含未闭合 `<think>` 时剔除其后全部内容）；剔除后无剩余可展示文本时，preview SHALL 回退到该 message 的下一可用非空 text part，仍无则该字段缺省，SHALL NOT 以空白或推理原文充当 preview。Preview 最多160 code points；SHALL NOT读取Artifact body。Preview SHALL NOT参与v1 search。

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

#### Scenario: Preview 剔除 think 推理区间
- **WHEN** 最新 persisted message 的首个非空 text 为 `<think>…</think>可见回复` 或以未闭合 `<think>` 开头
- **THEN** history item 的 preview 不含 `<think>` 标签或推理原文，只展示可见回复（未闭合时 preview 为空并按缺省处理），详情页的折叠推理渲染不受影响
