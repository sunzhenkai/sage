# Tasks

- [x] 1. migration `005_chat_archive.sql`（`archived_at` 列 + 归档视图 partial index）并在 `migrations.ts` 注册 checksum；`migrations.test.ts` 核对 manifest
- [x] 2. `app-contracts`：`SessionSchema`/`SessionHistoryItemSchema` 增加可选 `archivedAt`；`ListSessionsQuerySchema` 增加 `archived: 'true'|'false'`
- [x] 3. `chat-domain history.ts`：`normalizeSessionFilters`/`NormalizedSessionFilters`/`sessionFilterHash` 纳入 `archived` 维度；单元测试覆盖 cursor 跨视图混用
- [x] 4. `ChatStore`：`listSessions` 归档过滤与 `archivedAt` 映射；`archiveSession`/`unarchiveSession` 幂等实现；`deleteSession` 单事务删除（含 GUC 逃生门）；`acceptUserMessage`/`createRetryRun` 归档只读守卫
- [x] 5. PostgreSQL 集成测试：归档幂等/过滤/cursor 绑定、恢复、彻底删除（含 promotion 场景与 audit 保留、原子性、404）、归档只读
- [x] 6. `agent-api`：`POST .../archive`、`POST .../unarchive`、`DELETE .../sessions/:sessionId` 路由与错误映射；`GET /v1/chat/sessions` 解析 `archived`；API 测试（fake store）
- [x] 7. `agent-web`：ChatLanding 视图切换、行内归档/恢复/两步删除、空态与反馈；`ChatApp` 归档只读提示；`locale.tsx` 中英文案；`styles.css` 行操作样式
- [x] 8. agent-web RTL 测试：视图切换参数、归档流、两步删除（取消/确认/失败）、归档只读
- [x] 9. `pnpm typecheck`、`pnpm lint`、chat 相关 vitest 全绿；`openspec validate chat-session-archive-delete --strict` 通过
- [x] 10. 归档 change 并同步 specs（`openspec archive`）
