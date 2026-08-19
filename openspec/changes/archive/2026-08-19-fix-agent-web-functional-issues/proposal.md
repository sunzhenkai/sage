## Why

`platform/apps/agent-web` 是目前 Sage 本地工作区的 Web 入口，但在实际渲染和交互测试中发现多处影响可用性的功能缺陷：错误态与空状态同时出现、Provider 弹窗无法通过 Esc/蒙层关闭、Chat 会话恢复失败时输入区仍可操作、以及若干未走本地化系统的提示文案。这些问题会降低用户对焦点的判断，并在中英文切换时产生不一致的界面语言。本变更在现有架构内修复这些功能问题，不引入新的外部依赖或破坏性接口变更。

## What Changes

- **Chat / Tasks 列表错误态清理**：当后端接口返回错误时，仅显示错误横幅，不再同时渲染「空状态」面板。
- **Provider 弹窗交互补全**：新增 `Esc` 关闭与点击蒙层关闭；关闭后将焦点返回到「+ Add provider」按钮。
- **Chat 会话恢复失败状态修复**：非 404 错误（如 502）导致会话状态未知时，禁用 Composer，避免用户误以为可以发送消息。
- **提示文案本地化**：Provider 保存成功、目录同步状态的提示改为使用 `locale.tsx` 中的翻译键，确保中英文一致。
- **导航快捷键移除或实现**：移除侧边栏 Chat 项上的 `⌘ K` 标注，或实现真正的全局快捷键。
- **Task 详情刷新防重入**：刷新期间禁用刷新按钮，避免重复请求。
- **Provider 通知防覆盖**：为异步通知增加版本/取消机制，避免过期请求覆盖最新提示。

## Capabilities

### New Capabilities

无新增能力。本变更纯为现有 Web 界面的功能修复与可用性改进。

### Modified Capabilities

- `chat-user-interface`：Chat 会话恢复失败时的 Composer 可用性状态、错误态与空状态的互斥呈现。
- `chat-session-history`：会话历史列表在加载失败时的呈现逻辑。
- `browser-provider-profile-management`：Provider 弹窗的键盘与焦点管理、保存/同步提示的本地化。
- `web-interface-localization`：补充并统一 Provider 相关提示的翻译键。
- `workspace-status-presentation`：错误状态与空状态在 Chat/Tasks 工作区的展示规则。
- `task-operations-interface`：Task 详情刷新操作的防重入控制。

## Impact

- 影响范围：`platform/apps/agent-web/src` 下的 `chat.tsx`、`tasks.tsx`、`workspace.tsx`、`providers.tsx`、`locale.tsx`。
- 测试：需要更新或新增对应的单元/交互测试；现有 39 个测试需保持通过。
- 无 API 变更、无 schema 变更、无破坏性改动。
