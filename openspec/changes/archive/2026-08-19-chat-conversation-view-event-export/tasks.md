# Tasks

- [x] 1. locale 双语键：新增对话呈现（思考中/尝试次数/活动行）、事件流面板、复制反馈等 zh-CN/en 键
- [x] 2. `chat.tsx`：实现 `buildTurns` 轮次分组纯函数与对话式渲染（用户/助手气泡、轮次状态、活动行、task 卡片、placeholder 保留）
- [x] 3. `chat.tsx`：事件流调试面板（元信息 + 逐事件原始行）与 `serializeEventStream` / `copyText`（clipboard + execCommand 回退）及成功/失败反馈
- [x] 4. `styles.css`：气泡、轮次、活动行、事件流面板样式与移动端适配
- [x] 5. 测试：更新 `chat.test.tsx` 契约断言至对话式呈现；新增轮次分组、JSONL 序列化、复制回退测试
- [x] 6. `pnpm lint` + `typecheck` + agent-web 相关 vitest 全绿
- [x] 7. `openspec validate chat-conversation-view-event-export --strict` 通过并归档
