# 切片:Agent Library 双 Host 复用

## 目标

Chat Service(短/长请求)与 Temporal Activity(长请求)通过**同一个** Agent Library 执行 Agent Run,不复制 Loop。

## 入口

- 短请求:`platform/apps/agent-api/src/runs-api.ts` → `LocalAgentClient`;
- 长请求:`platform/apps/agent-worker/src/activities.ts` 的 `runAgentActivity` → `LocalAgentClient`;
- 共同入口:`platform/packages/agent-client/src/index.ts` 的 `createClient` → `platform/packages/agent-lib/src/kernel.ts`。

## SOURCE

- `platform/packages/agent-lib/src/kernel.ts`
- `platform/packages/agent-client/src/{index,canonical,execution-policy}.ts`
- `platform/apps/agent-worker/src/activities.ts`
- `platform/examples/p4-integration/src` 中的 `runAgent` 调用链

## 契约

- [结构契约:LocalAgentClient API](../contracts/structure.md)
- [行为契约:Chat 流式 + 长请求提升](../../flows/chat-short-run.md)
- [运行时契约:Run 数量与时长指标](../contracts/runtime.md)

## 处理线

- [Chat 短请求 Agent Run](../../flows/chat-short-run.md)
- [Chat 长请求提升为 Temporal Task](../../flows/chat-elevated-task.md)

## 生命周期

| 阶段 | 状态 |
|------|------|
| identified | ✅ |
| characterized | ✅(`docs/design/agent-library-mvp.md` + 源码对照) |
| specified | ✅(`@sage/agent-contracts` + `@sage/platform-ports` 覆盖调用面) |
| implemented | ✅(Chat 与 Activity 都过 `LocalAgentClient`) |
| verified | ✅(`examples/p4-integration` + `apps/agent-api/src/runs-api.test.ts`) |
| canary | 不适用(单实现,无灰度) |
| migrated | 不适用 |
| retired | 不适用 |

## 副作用

- LLM 调用 → `effect_ledger_entries`;
- Agent State 推进 → `agent_runs`;
- Chat 流事件 → `chat_sessions`。

## 验证方式

- 单元:`platform/packages/agent-lib/src/kernel.test.ts`、`platform/packages/agent-client/src/index.test.ts`;
- 集成:`pnpm test:p4:integration` + `pnpm test:p6:e2e`;
- 行为:`platform/apps/agent-web/src/chat.runtime.test.tsx`、`platform/apps/agent-worker/src/activities.coordinator.test.ts`。
