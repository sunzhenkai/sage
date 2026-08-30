## 1. Chat 实时更新（P0）

- [x] 1.1 agent-api：chat timeline SSE 循环加入 ≤20s 周期心跳注释帧（`: ping`），不影响 timeline 事件语义（`platform/apps/agent-api/src/index.ts`）
- [x] 1.2 agent-web：`chat.tsx` 的消息提交路径在 POST 202 成功后，以最新 cursor 发起一次 `GET /events?afterSequence=<cursor>` 并经 `deduplicate()` 合并进 events state；补拉失败静默保持既有订阅
- [x] 1.3 agent-web：SSE 重连/重建时使用合并后的最新 sequence 作为 `afterSequence`，避免重放
- [x] 1.4 测试：为「POST 202 后补拉合并」「补拉与 SSE 幂等去重」「补拉失败不重置」补组件级测试（`chat.runtime.test.tsx` / `chat.interaction.p6.test.tsx` 风格）

## 2. 会话预览与搜索（chat-domain）

- [x] 2.1 `safeHistoryPreview`：归一化/截断前剔除 `<think>…</think>` 区间；未闭合 `<think>` 剔除其后全部内容；剔除后为空回退下一可用非空 text part（`platform/packages/chat-domain/src/history.ts`）
- [x] 2.2 history 列表 SQL：`q` 谓词改为 effective title 匹配（`title IS NULL` 时按 locale 回退 `Untitled Chat`/`未命名对话`），保持既有 escape/ILIKE 语义与 cursor 绑定不变（`platform/packages/chat-domain/src/index.ts`）
- [x] 2.3 API：history 路由接受并向 store 传递 locale（或 fallback 文案）参数，schema 校验同步更新（`platform/apps/agent-api/src/index.ts`）
- [x] 2.4 测试：preview 剥离（闭合/未闭合/全 think 回退）与搜索命中/不命中（en/zh）单测；更新受影响的既有 chat-domain 测试

## 3. 任务 Timeline 事件链路

- [x] 3.1 temporal-routing：在常规投影推进（`writeProjection` 成功路径）同步调用 `appendProjectionEvents` 写入状态迁移事件，revision 顺序一致
- [x] 3.2 事件追加失败仅记录可观测日志/指标，不回滚投影、不改变 stale 语义
- [x] 3.3 测试：投影推进后 `listTaskEvents` 返回按序事件；追加失败时投影仍推进（fake store 注入失败）
- [x] 3.4 agent-web（可选打磨）：Timeline 为空且投影 stale/unavailable 时提示投影滞后原因，替代一律显示「无事件」文案（`platform/apps/agent-web/src/tasks.tsx`）

## 4. Providers 弹窗反馈与删除确认

- [x] 4.1 `workspace-providers.tsx`：新增 `dialogError` state，`save()` 校验/API 失败写入并传入 `WorkspaceProviderDialog`，渲染在提交按钮上方可见位置；成功或重新打开时清除；输入内容失败时保留
- [x] 4.2 `providers.tsx`：页面级 notice 不再承载弹窗内错误（保留列表操作的反馈用途）
- [x] 4.3 删除两段式确认：`confirmingDeleteId` state + 就地确认/取消控件，确认才调用 `remove()`；复用/新增 locale 文案
- [x] 4.4 默认模型警告：将 `runAgent.providerConnectionId` 下传列表组件，确认态对默认模型条目追加警告文案
- [x] 4.5 测试：弹窗错误可见性、失败保留输入、两段式确认与取消、默认模型警告（`workspace-providers` 既有测试文件风格）

## 5. 本地化与 Promote 入口

- [x] 5.1 `workspace.tsx`：session 状态徽章经 `t('open')/t('closed')` 映射渲染，未知值回退原文
- [x] 5.2 `chat.tsx`：run 状态（`ready/active/succeeded` 等）与工具状态徽章走字典映射；`locale.tsx` 补缺失键（如 `runActive`），中英文齐全
- [x] 5.3 Promote 成功 notice 增加任务入口链接（指向返回的任务标识；无标识时指向会话任务工作台），样式与 Start run 的 "View run" 一致（`workspace.tsx` / `chat.tsx`）
- [x] 5.4 测试：徽章中英文渲染断言、promote 成功提示含入口断言

## 6. 回归与验收

- [ ] 6.1 `pnpm lint` / `pnpm typecheck` / `pnpm test`（platform 全量）通过
- [ ] 6.2 `openspec validate fix-agent-web-gui-smoke-defects --strict` 通过
- [ ] 6.3 浏览器回归（本地栈）：发消息即时上屏、预览无 `<think>`、搜 `Untitled`/`未命名对话` 命中、任务详情 Timeline 非空、弹窗错误可见、删除需确认、中文徽章本地化、promote 提示可跳转
- [ ] 6.4 更新 `gui-test-screenshots` 回归证据并同步测试报告结论
