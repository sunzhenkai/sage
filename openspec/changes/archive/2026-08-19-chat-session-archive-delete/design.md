# Design: chat-session-archive-delete

## 上下文

Chat session 目前由 `chat_sessions.status ('open'|'closed')` 表达生命周期，历史列表按 `(updated_at DESC, session_id DESC)` keyset 分页，retention job 最早可在 `updated_at + retention_days` 删除。用户缺少两个主动权：把对话移出主列表（归档），以及立即、不可撤销地删除对话（彻底删除）。

## 目标 / 非目标

**目标**

1. 归档是独立于 `open`/`closed` 的正交维度：`archived_at IS NULL` 表示未归档。
2. 主列表默认排除归档；归档视图仅含归档。
3. 归档视图内可彻底删除：单事务、跨全部 chat 表、不可撤销。
4. 归档会话只读，语义与 closed 对齐。

**非目标**

- 不做批量归档/批量删除。
- 不改变 retention job 语义（`retentionEligibleAt` 仍由 `updated_at + retention_days` 计算，归档不刷新 `updated_at`）。
- 不删除 durable task 侧数据；task 自身的删除属于 task-operations 能力。
- 不提供归档自动过期。

## 数据模型

Migration `005_chat_archive.sql`：

```sql
ALTER TABLE chat_sessions ADD COLUMN archived_at timestamptz NULL;
CREATE INDEX chat_sessions_archived_history_idx
  ON chat_sessions (tenant_id, updated_at DESC, session_id DESC)
  WHERE archived_at IS NOT NULL;
```

- `archived_at` 语义：非空即归档，值即首次归档时间（重复归档用 `COALESCE` 保留原值，保证幂等）。
- 归档/恢复只写 `archived_at`，不触碰 `updated_at`/`status`。

## API 语义

| 路由 | 行为 | 失败 |
|---|---|---|
| `POST /v1/chat/sessions/:id/archive` | `archived_at := COALESCE(archived_at, now)`，返回更新后 `Session` | 404 `CHAT_SESSION_NOT_FOUND` |
| `POST /v1/chat/sessions/:id/unarchive` | `archived_at := NULL`，返回 `Session`（未归档时为幂等 no-op） | 404 同上 |
| `DELETE /v1/chat/sessions/:id` | 单事务彻底删除，204 无 body | 404 同上；存储故障 503 |

- `GET /v1/chat/sessions` 增加 `archived` query（`'true'|'false'`，缺省 false）；缺省与 `false` 均只返回 `archived_at IS NULL`，`true` 只返回 `archived_at IS NOT NULL`。`status` 过滤保持正交。
- `archived` 并入 `normalizeSessionFilters` → `sessionFilterHash`：跨视图混用 cursor 得到 400 `CHAT_INVALID_REQUEST`（与既有 filter 绑定语义一致）。
- `Session` / `SessionHistoryItem` 增加可选 `archivedAt`。

## 删除事务与审计边界

`deleteSession(tenantId, sessionId)` 单事务按依赖序删除：

1. `chat_promotion_handoff_outbox`（FK → handoffs）
2. `chat_promotion_handoffs`（FK → messages、associations）
3. `chat_task_associations`（FK → messages；受 append-only 触发器保护）
4. `chat_message_parts` → `chat_messages`（FK → sessions）
5. `chat_timeline_events`（FK → sessions、runs）→ `chat_runs`（FK → sessions、messages）
6. `chat_summaries` → `chat_sessions`

- `chat_task_associations` 的 `BEFORE DELETE` 触发器要求事务内设置 `sage.tenant_deletion_request_id` 且 `sage.tenant_deletion_tenant_id = OLD.tenant_id`。删除实现以事务级 `set_config(..., true)` 设置 `session-delete-<sessionId>` 请求 id 与当前租户，复用该逃生门且不放宽到跨租户。
- `chat_promotion_audit` / `chat_promotion_handoff_audit` 无外键指向被删行且被触发器强制 append-only：它们不含对话内容（仅 id、mode、reason、时间戳），作为合规账本保留。彻底删除的承诺范围是「对话内容不可恢复」，在 spec 中显式声明该边界。
- 删除期间并发写（提交消息/归档）由行级锁与事务原子性排除：先 `SELECT ... FOR UPDATE` 锁定 session 行再删除。

## 归档只读守卫

`acceptUserMessage` 的 session UPDATE 条件从 `status='open'` 收紧为 `status='open' AND archived_at IS NULL`；`createRetryRun` 在锁定 failed run 后校验所属 session 未归档。归档中的会话打开时走既有 closed 只读 UI 路径（前端以 `session.archivedAt` 判定）。

## UI 结构

- Chat landing 工具栏新增视图切换（`对话 | 归档`，segmented control，`aria-pressed` 表达当前项）。切换重置列表并按 `archived` 参数重新请求；搜索与 status 过滤在两个视图均可用。
- 历史行由纯链接改为「链接主体 + 行内操作区」：
  - 未归档视图：「归档」按钮。
  - 归档视图:「恢复」与「删除」按钮；「删除」为两步确认——第一次点击进入确认态（行内出现「彻底删除？不可撤销」与确认/取消），确认后才发 `DELETE`。不用 `window.confirm`，保证可测与样式一致。
- 操作成功以行移除 + 成功 notice 表达；失败复用既有 error banner。
- 归档视图空态文案与主列表区分（「暂无归档对话」）。
- Chat 页（`ChatApp`）：detail 返回 `archivedAt` 时 Composer 区展示「已归档只读」提示，禁用发送/Retry/Promote，与 closed 同视觉层级；事件流复制保持可用。

## 测试策略

- `chat-domain` 单元：`normalizeSessionFilters`/`sessionFilterHash` 覆盖 `archived` 维度；cursor 跨 archived 视图混用抛错。
- `chat-domain` PostgreSQL 集成（`WORKSPACE_POSTGRES_URL`）：归档幂等、列表过滤与 cursor 绑定、恢复、彻底删除后全部子表为空且 404、含 promotion 的 session 删除（走 GUC 逃生门，audit 保留）、归档会话拒绝 `acceptUserMessage`。
- `agent-api`：三条路由的 status code / 错误映射 / query 严格校验（fake store）。
- `agent-web`（RTL）：视图切换请求参数、归档操作、两步删除确认流（取消不发请求、确认发 DELETE 并移除行）、归档会话只读提示。
- migration ledger：新 migration checksum 注册与有序应用（沿用既有 `migrations.test.ts` 模式核对 manifest 长度/校验和计算）。

## 风险与权衡

- **审计账本保留** vs「彻底」直觉：账本不含内容且被 append-only 触发器保护；在 UI 确认文案与 spec 中明示边界。
- **cursor hash 变更**：`filterHash` 输入新增 `archived` 字段，旧 cursor 全部失效——cursor 本就是短生命周期续页令牌，可接受。
- **删除并发**：以 `FOR UPDATE` session 行 + 单事务规避部分删除。
