# chat-domain

Chat 领域:ChatSession、流式消息、Tool/Artifact 流、Chat 持久化。负责把 StreamEvent 落库与读回,不写 Web UI(UI 在 `apps/agent-web`)。

## 根

| 路径前缀 | 角色 |
|----------|------|
| `platform/packages/chat-domain` | Chat 领域包 |

## 文件

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 公共导出 | — |
| `history.ts` | Chat 历史读写(按 sessionId 拉流) | `appendEvent`、`readHistory` |
| `migrations.ts` | Chat schema 迁移 | `migrate` |
| `history.test.ts` / `migrations.test.ts` / `history.integration.test.ts` / `p6-immutability.integration.test.ts` | 测试 | — |

## 对外入口

- `history.appendEvent(sessionId, event)` — 落 StreamEvent(同事务内);
- `history.readHistory(sessionId, opts)` — 拉流;
- `chat-domain` 暴露给 `apps/agent-api` 与 `apps/agent-web`。

## 核心符号

- `history.appendEvent` — 同一 Postgres 事务落 Session 更新 + StreamEvent;
- `history.readHistory` — 拉流,可按 sinceSeq 过滤;
- `migrations.migrate` — schema 迁移(由 `postgres-migrations` 调度);
- `p6-immutability` — 测试覆盖事件不可改、Append-only。

## 依赖

- 模块 [state-persistence](../state-persistence/README.md) — Postgres 适配;
- 模块 [agent-lib-runtime](../agent-lib-runtime/README.md) — StreamEvent 类型与 ReferenceEnvelope;
- 模块 [apps](../apps/README.md) — agent-api、agent-web 装配。
