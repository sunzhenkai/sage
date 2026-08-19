## Why

侧边栏「对话」导航项当前通过 `workspaceHref({ view: 'chat', sessionId })` 保留 `session` query：用户已在某个 session 视图时点击「对话」，仍停留在当前会话而不是对话列表。用户的预期是左侧「对话」作为列表入口（与页头「← 返回对话列表」一致）；保留 session 的职责应由 Tasks/Providers 视图切换链接与任务→对话深链承担。

## What Changes

- **侧边栏 Chat 导航指向列表**：侧边栏「对话」导航项 SHALL 始终链接到 canonical Chat landing（`/`，不带 `session` query），无论当前是否处于某个 session 视图。桌面与移动端共用同一导航标记。
- **session 保留语义收窄**：Tasks / Providers 导航项与任务详情「前往对话」链接继续保留 `session` query；返回具体会话经历史列表或任务深链完成。
- 修订 `chat-user-interface` 的「Minimum Chat execution interface」要求中「跨 Workspace 保留 session」场景以匹配上述语义，并新增「侧边栏对话导航到列表」场景。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `chat-user-interface`：侧边栏 Chat 导航与会话保留语义。

## Impact

- 影响范围：`platform/apps/agent-web/src/main.tsx`（侧边栏 Chat 链接）与 `header-alignment.test.tsx` 断言；无 API/schema 变更。
