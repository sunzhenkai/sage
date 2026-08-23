## Why

sage agent-web 无任何客户端路由：所有导航是 `<a href="?view=...">` 整页链接 + `window.location.assign()`，每次导航/刷新都触发完整页面加载、React 全量重新引导，是页面闪屏的根因。

## What Changes

- 引入原生 History API 客户端路由：`navigate()` 用 `history.pushState` 切换视图，监听 `popstate` 支持前进/后退
- 全局拦截站内 `<a>` 点击，命中查询路由链接时 `preventDefault` + `navigate`，布局/侧边栏不重挂载
- 视图状态（view/sessionId/taskId/packageId）从一次性读 `location.search` 上浮为响应式 `useLocation`
- `WorkspaceShell` 布局只渲染一次，主区按 view 切换内容组件
- 视图切换只重拉所需数据；切走时关闭无关 SSE，切回按 `afterSequence` 增量拉取
- 同步适配依赖 `renderWorkspace()`/`location` mock 的测试（workspace/chat/tasks/packages/providers）

## Capabilities

### New Capabilities
- `client-side-routing`: 单页应用的客户端路由能力：导航不整页重载、前进/后退恢复上下文、视图切换仅重拉所需数据

### Modified Capabilities
- `chat-user-interface`: 导航语义从整页跳转改为客户端路由，跨视图 session 上下文保留的行为不变但不再触发整页重载

## Impact

- `platform/apps/agent-web/src/main.tsx`：路由状态上浮、全局 `<a>` 拦截、内容切换
- `platform/apps/agent-web/src/workspace.tsx`：`workspaceHref` 语义、`navigate` 默认实现
- `platform/apps/agent-web/src/{chat,tasks,packages,providers}.tsx`：`useEffect` 依赖精确化（如有需要）
- 测试：`*.test.tsx` 的 `renderWorkspace()`/`location` mock 适配
- 无新增依赖（原生 History API）
