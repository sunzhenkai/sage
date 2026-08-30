## Why

2026-08-30 对本地运行栈（agent-web vite dev + agent-api 9610）做的全视图 GUI 黑盒冒烟测试发现 1 个 P0 缺陷与 6 个 P1/P2 缺陷：会话详情页收不到实时更新（后端 202 受理并完成 run，但打开中的界面不追加任何事件）、会话列表预览泄露 `<think>` 原文、任务详情 Timeline 恒为 0 events、Providers 表单校验错误渲染在视口外、删除 Provider 无二次确认、搜索 "Untitled" 匹配不到显示为 Untitled Chat 的会话、中文界面状态徽章残留英文。这些缺陷横跨 agent-web 与 chat-domain/task 链路，均已有明确根因定位，适合一次性收敛修复。

## What Changes

- 会话实时更新（P0）：发送消息 POST 返回 202 后，Web 立即做一次 `GET /v1/chat/sessions/:id/events?afterSequence=<cursor>` 增量补拉并合并进 timeline state，保证自己的消息与后续事件即使 SSE 链路停滞也即时可见；agent-api 的 chat timeline SSE 增加周期性心跳注释帧（`:ping`），用于保活与链路诊断；SSE 重连复用最新 cursor。
- 会话预览剥离 think（P1）：`chat-domain` 的 history preview 生成在归一化/截断前剔除 `<think>…</think>` 区间（含未闭合兜底），列表与归档页不再泄露推理原文；详情页折叠渲染行为不变。
- 搜索覆盖未命名会话（P2）：history 搜索谓词对 NULL title 回退到默认显示标题（"Untitled Chat"/"未命名对话"）参与匹配，显示与搜索一致。
- 任务 Timeline 事件（P2）：为 `task_event_projection` 打通运行时写入链路，使任务详情 Timeline 不再恒为空（前端渲染逻辑不变）。
- Providers 弹窗内错误反馈（P1）：Add/Edit workspace provider 弹窗自带错误态，校验/API 失败信息渲染在表单内可见位置，不再依赖被遮罩遮挡的页面级 notice。
- Provider 删除二次确认（P2）：✕ 删除改为两段式确认（复用 Chat landing 的 confirming 模式）；删除当前默认模型条目时确认文案附带警告。
- 状态徽章本地化（P2）：会话列表状态徽章与 chat run 状态走 locale 映射，中文界面不再出现裸 `open`/`succeeded` 等英文状态词。
- Promote to Task 成功提示附任务入口（P3）：promote 成功 notice 提供跳转到对应任务的链接，与 Start run 的 "View run →" 模式一致。

不在本 change 范围：vite HMR/tsx watch 环境稳定性问题（无代码缺陷）、Schedules service token 环境配置（fail closed 为设计行为）、Running 任务列表时间戳展示（数据源无时间，需先补数据面，另立 change）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `chat-event-resumption`: 新增"发送路径事件补拉"要求——POST 消息 202 后 Web SHALL 立即按最新 cursor 增量补拉并合并事件，SSE 停滞不阻塞自身消息可见性；timeline SSE SHALL 携带周期性心跳注释帧。
- `chat-session-history`: history item `preview` SHALL NOT 包含 `<think>` 推理区间；`q` 搜索 SHALL 对无 title 会话按默认显示标题匹配。
- `run-agent-settings`: workspace provider 新增/编辑弹窗 SHALL 在弹窗内渲染错误反馈；删除条目 SHALL 经两段式确认，删除默认模型条目时 SHALL 附带警告。
- `task-projection-reconciliation`: 投影事件写入 SHALL 在常规投影推进链路可用，任务详情 Timeline 不再依赖缺失的运行时接线（空 timeline 仅允许出现在确无事件的场景）。
- `web-interface-localization`: 用户可见的状态标签（badge/run status）SHALL 随 locale 渲染，不得输出未翻译的枚举原文。
- `chat-to-task-promotion`: promote 成功反馈 SHALL 提供到达所建任务的操作入口。

## Impact

- 代码：`platform/apps/agent-web/src/chat.tsx`（补拉合并、run 状态映射）、`workspace.tsx`（徽章映射、promote notice 链接）、`workspace-providers.tsx`（弹窗错误态、删除确认）、`providers.tsx`（notice 通道收敛）、`locale.tsx`（补字典键）；`platform/packages/chat-domain/src/history.ts` 与 `src/index.ts`（preview 剥离、搜索谓词）；`platform/apps/agent-api/src/index.ts`（SSE 心跳）；`platform/packages/temporal-routing`（投影事件写入接线）。
- API 行为：`GET /v1/chat/sessions` 的 `q` 匹配语义变化（对 NULL title 按默认标题命中）；SSE 帧流新增注释帧（对 `EventSource` 透明，非破坏性）。
- 兼容性：无 schema 变更、无破坏性 API 变更；现有 chat/tasks/providers 测试需同步更新。
- 验证：`pnpm lint/typecheck/test` + `openspec validate --strict`，并按 tasks.md 的验证清单做浏览器回归。
