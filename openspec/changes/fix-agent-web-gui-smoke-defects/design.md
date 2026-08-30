## Context

GUI 冒烟测试（2026-08-30）确认的缺陷与根因定位（详见 proposal.md Why）：

- agent-web 为 React 19 + Vite SPA，自研 query 路由（`src/routing.ts`），无状态库；chat timeline 由 `chat.tsx` 内 `recover()`（全量快照）+ `EventSource(/timeline?afterSequence=cursor)` 组成。
- chat-domain 是前后端共享包：history 列表 SQL 与 preview 生成在 `packages/chat-domain`，Web 列表仅照显示。
- 任务详情 Timeline 数据来自 `GET /v1/tasks/:id/events` → `task_event_projection` 表；该表唯一写入方 `TaskProjectionReconciler.runBatch()` 未接入任何运行时组合根（agent-api/agent-worker 均无实例化），常规投影推进 `writeProjection` 也不写事件——空 Timeline 是数据链路缺失，非前端渲染缺陷。
- Providers 弹窗错误目前只有一个通道：`onNotice` 冒泡到页面底部 `InlineNotice`，被 `.provider-modal-backdrop`（fixed 遮罩）遮挡且在折叠线以下。
- 测试环境注意：agent-api 与 agent-worker 以 `tsx watch` 运行、vite dev 代理 `/v1`；HMR 断连与后端自动重启属环境噪声，不在本 change 处理。

## Goals / Non-Goals

**Goals:**

- 用户发送的消息在任何 SSE 状态下都即时可见（P0 的用户体验底线）。
- 预览、搜索、徽章三类「显示与数据不一致」在数据源头修复，所有消费方受益。
- Providers 弹窗的反馈与确认符合最小可用交互规范。
- Timeline 事件链路打通，任务详情能看到真实状态迁移历史。

**Non-Goals:**

- 不重写 SSE 为 WebSocket/轮询，不引入前端状态库或路由库。
- 不改 chat event sequence、promotion 授权、projection 修复（reconciler）语义。
- 不处理 vite HMR 断连、tsx watch 重启、Schedules service token 等环境配置问题。
- 不做 Running 任务列表时间戳数据面补充（另立 change）。

## Decisions

1. **发送路径补拉（前端防御）而非只修 SSE 链路**：SSE 数据帧未达浏览器的确切根因（vite http-proxy 缓冲 vs 后端未推）在测试环境不可稳定复现，采用「POST 202 后一次性 `GET /events?afterSequence=cursor` 合并」保证语义正确性，与 SSE 到达顺序无关；`deduplicate()` 已按 sequence 去重，合并天然幂等。备选「乐观插入本地回显」被否决：本地回显与持久化事件形态不一致（缺 messageId/sequence），会产生双渲染与对账复杂度。
2. **SSE 心跳放 agent-api**：每 ≤20s 写一个 `: ping` 注释帧。注释帧对 EventSource 透明，可同时保活中间代理并让「连接 live 但无数据」可诊断；不选应用层 ping 事件（会污染事件流语义）。
3. **think 剥离在 chat-domain `safeHistoryPreview`**：预览是服务端生成的契约字段，源头剥离一次覆盖 Web 列表、归档与未来消费方；未闭合 `<think>` 视为「其后全部为推理」剔除，剔除后为空则回退下一可用 text part。不在前端 `workspace.tsx` 打补丁（契约层继续泄露）。详情页 `splitAssistantText()` 行为不变。
4. **搜索 NULL title 回退默认标题（SQL `COALESCE` 语义）**：谓词改为 effective title 匹配（NULL → `Untitled Chat` / `未命名对话`，按请求 locale）。备选「createSession 落库默认标题」被否决：与既有 spec「NULL title 创建、首条消息才派生」冲突，需迁移且有覆盖显式 title 的风险。locale 维度以查询参数传入，不新增存储。
5. **Timeline 事件在常规投影链路同步追加**：在 `writeProjection` 推进处同步调用既有 `appendProjectionEvents`（表与读取 API 均已存在），事件写入失败仅记录可观测日志、不回滚投影。备选「接线 TaskProjectionReconciler 定时跑批」被否决为主方案：reconciler 定位是修复而非常规写入，跑批延迟与覆盖不满足「详情页即时可见」；reconciler 保留原职责不变。
6. **Providers 弹窗错误本地态 + 两段式删除确认**：`WorkspaceProvidersCard` 增加 `dialogError` state 传入 `WorkspaceProviderDialog` 渲染在提交按钮上方（复用 `InlineNotice` 样式）；删除复用 Chat landing 的 `confirmingId` 两段式模式；默认模型警告需把 `runAgent.providerConnectionId` 下传到列表组件。
7. **状态徽章本地化走既有字典映射模式**：参照 `tasks.tsx` 的 `statusLabel()`，在 `workspace.tsx`（session 徽章）与 `chat.tsx`（run 状态）加映射；`locale.tsx` 补 `runActive` 等缺失键。未知值回退原文。

## Risks / Trade-offs

- [补拉与 SSE 同时到达造成短暂重复渲染] → 合并统一走 `deduplicate()`，sequence 单调保证幂等；补拉仅在 POST 成功后触发一次，无轮询放大。
- [心跳增加服务端定时器与连接写入] → 20s 间隔、注释帧仅数字节，单连接成本可忽略；本地 dev 场景连接数极小。
- [effective title 匹配使非中文/英文 locale 的搜索行为依赖 fallback 文案] → 仅 `en`/`zh-CN` 为受支持 locale（既有 spec），其余 locale 请求按 en 文案回退，行为确定。
- [writeProjection 内追加事件引入写放大] → 事件行极小且频率等于投影推进频率；失败路径只降级不阻断，风险可控。
- [删除确认增加一次点击成本] → 仅对破坏性操作生效，且带默认模型警告，属可接受交互成本。
- [测试环境无法端到端复现 P0 原始故障] → 补拉修复不依赖根因判定即恢复用户可见正确性；同时以心跳帧改善可诊断性，SSE 链路问题若再现可通过 Network 面板帧序列定位。

## Migration Plan

- 无 schema 迁移、无破坏性 API 变更；`q` 匹配语义变化与 SSE 注释帧对现有 client 透明。
- 发布顺序：先后端（chat-domain/agent-api/temporal-routing），后前端（agent-web）；因同仓同进程本地栈，实际以一次重启生效。
- 回滚：按文件粒度 revert 即可，无数据回填需求。

## Open Questions

（无——P0 的 SSE 帧丢失根因若在实施期的集成测试中定位为 vite 代理缺陷，将另行立项，不影响本 change 的防御性修复方案。）
