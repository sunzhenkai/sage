## Why

`platform/apps/agent-web` 的 Chat 页面目前把 `chat_timeline_events` 里的每一类事件（text/run/tool/artifact/task/error）作为同权重的时间线条目平铺渲染，并常驻展示 session id、事件序号、终态 run 状态的检查器信息。实际观感是「管道验证/debug 页」而不是对话页：run 生命周期（active/succeeded、尝试次数）插在消息中间，用户消息与助手回复没有视觉区分，排查信息挤占了对话空间。

本变更把 Chat 页面改造为真正的对话式界面，同时把排查能力显式产品化：新增可折叠的事件流调试面板，以及「一键复制完整事件流」能力，供问题排查与缺陷上报。

## What Changes

- **对话式轮次渲染**：以 runId 为单位把事件分组为对话轮次（turn）。用户消息渲染为右对齐气泡；助手输出渲染为左侧气泡；run 的 active/paused 状态折叠为轮次级「思考中」指示，failed 渲染为轮次内错误与 Retry；tool/artifact 活动折叠为助手侧紧凑活动行；task 事件仍内联渲染为任务卡片。
- **移除常驻概览条**：session id / 事件序号 / 终态 run 状态不再常驻页面，移入事件流调试面板。
- **事件流调试面板**：页头新增「事件流」开关，展开后显示会话元信息与逐事件原始列表（序号、时间、类型、payload）。
- **复制事件流**：提供「复制事件流」按钮，将当前已加载的全部 timeline 事件按 JSONL（每行一个完整事件对象）写入剪贴板；`navigator.clipboard` 不可用或失败时回退到 `document.execCommand('copy')`；成功/失败均有界面反馈；closed 只读会话同样可复制。
- **本地化**：所有新增文案进入 `locale.tsx` 的 zh-CN / en 双语键。

## Capabilities

### New Capabilities

无新增能力。

### Modified Capabilities

- `chat-user-interface`：呈现模型由「事件时间线优先」改为「对话轮次优先 + 可折叠事件流调试视图」，并新增事件流导出（复制）要求。

## Impact

- 影响范围：`platform/apps/agent-web/src/chat.tsx`、`locale.tsx`、`styles.css`，以及 `chat.test.tsx` 等测试。
- SSE 恢复、deduplicate、Composer IME 语义、promotion/retry 请求协议均不变。
- 与进行中的 `fix-agent-web-functional-issues` 变更都触及 `chat.tsx`；该变更尚未实现（0/28），落地顺序上本变更先重构呈现层，后续该变更基于新结构实施。
- 无 API、schema、依赖变更。
