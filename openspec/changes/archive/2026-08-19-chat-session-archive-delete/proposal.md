## Why

对话历史目前只有 `open`/`closed` 状态与 30 天 retention 语义：用户无法把已完成但仍有价值的对话移出主列表，也无法主动、立即地移除不再需要的对话，只能等待 operator retention job。需要一个显式归档层，让主列表只呈现未归档对话，并允许在归档视图内对对话执行不可撤销的彻底删除。

## What Changes

- **数据模型**：`chat_sessions` 新增 `archived_at timestamptz NULL`（migration `005_chat_archive`）；归档/恢复 SHALL NOT 改变 `updated_at`，从而不刷新 retention 排序与 `retentionEligibleAt`。
- **归档 API**：`POST /v1/chat/sessions/:sessionId/archive`（幂等，重复归档保留首次 `archived_at`）；`POST /v1/chat/sessions/:sessionId/unarchive`（幂等，恢复原 `open`/`closed` 状态）。
- **彻底删除 API**：`DELETE /v1/chat/sessions/:sessionId` 在单事务内删除该 session 的 messages、message parts、runs、timeline events、summaries、promotion handoffs（含 outbox）与 task associations 及 session 本身；`chat_promotion_audit` 与 `chat_promotion_handoff_audit` 依 append-only 合规约束保留（它们不含对话内容）。删除 task associations 需通过既有 `sage.tenant_deletion_*` GUC 逃生门并限定同租户。
- **History API**：`GET /v1/chat/sessions` 默认仅返回未归档 session；新增 `archived=true|false` query 参数（严格校验，并入 cursor `filterHash` 绑定）；`Session` 与 `SessionHistoryItem` 增加可选 `archivedAt`。
- **只读语义**：archived session SHALL 与 closed 一致只读：禁止提交新消息与 retry，不隐式 reopen；恢复（unarchive）后回到原状态语义。
- **Web UI**：Chat landing 提供「对话 / 归档」视图切换；未归档行提供「归档」操作；归档行提供「恢复」与「彻底删除」（两步显式确认）；打开归档会话时展示已归档只读提示。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `chat-session-history`：归档状态与列表过滤、归档/恢复/彻底删除 API、归档只读语义。
- `chat-user-interface`：归档视图切换与行内操作、两步删除确认、归档只读提示。

## Impact

- `platform/packages/app-contracts`：`SessionSchema`、`SessionHistoryItemSchema`、`ListSessionsQuerySchema`。
- `platform/packages/chat-domain`：migration `005_chat_archive`、`ChatStore`（`archiveSession`/`unarchiveSession`/`deleteSession`、`listSessions` 过滤、写路径归档守卫）、`history.ts` 过滤归一化。
- `platform/apps/agent-api`：新增三条路由与 `archived` query 解析。
- `platform/apps/agent-web`：`workspace.tsx`（ChatLanding）、`chat.tsx`（归档只读）、`locale.tsx`、`styles.css`。
