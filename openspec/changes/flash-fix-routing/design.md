## Context

当前 `main.tsx` 的 `renderWorkspace(search)` 一次性读 `location.search` 决定 view；`workspace.tsx` 的 `workspaceHref` 生成 `?view=...` 链接、`navigate` 默认 `window.location.assign(href)`。所有导航即整页跳转。现有 `chat-user-interface` spec 已规定跨视图 session 保留语义（`?view=chat&session=...` 等），路由化必须保持这些 URL 形态不变。

## Goals / Non-Goals

**Goals:**
- 站内导航不整页重载（pushState），前进/后退（popstate）恢复
- 布局/侧边栏不重挂载，主区按 view 切换
- 视图切换只重拉所需数据，切走释放 SSE

**Non-Goals:**
- 不引入 react-router
- 不改变 URL 查询参数形态（`?view=...` 保持兼容既有深链）
- 不改后端/API

## Decisions

### D1 轻量路由封装：`useLocation` + `navigate`（模块 `routing.ts`）
新建 `src/routing.ts`：
- `navigate(href: string)`：同源查询路由用 `history.pushState(null, '', href)` + `window.dispatchEvent(new PopStateEvent('popstate'))` 或自定义事件；非同源/文件下载走默认。
- `useLocation()`：`useSyncExternalStore` 订阅 `popstate` 事件，返回 `URLSearchParams(location.search)` 的稳定引用。
- 保持 `workspaceHref` 不变（仍生成 `?view=...`），链接语义不变。

### D2 全局 `<a>` 拦截器
在根组件（`WorkspaceShell` 或 `main.tsx` 渲染入口）挂 `onClick` 委托：
- 命中 `closest('a[href]')` 且 href 是站内查询路由（`href` 以 `?` 开头或同源同 path 带查询）→ `preventDefault` + `navigate(href)`。
- 其他（外部链接、`target=_blank`、下载）放行。
- 用事件委托（`document` 或根容器捕获）而非逐个绑定，覆盖侧边栏/历史/任务/包全部 `<a>`。

### D3 布局/内容分离
`renderWorkspace()` 改为：`WorkspaceShell` 只挂载一次（`view`/参数来自 `useLocation`），主区 `content` 按 `view` 渲染。**避免重挂载约束**：内容区用 `key={view + (sessionId ?? '')}`（仅 view+session 变化才重挂载 ChatApp；切 view 但 session 不变时 ChatApp 仍可能重挂载——这是期望的，因为视图变了），布局不随内容重挂载。`ChatApp` 的 `useEffect` 依赖 `[apiBase, sessionId, fetcher]` 已有，切 view 离开时 cleanup 关 SSE。

### D4 测试适配
现有测试调用 `renderWorkspace(search)`（纯函数，读参数不读全局）——`renderWorkspace` 保持纯函数签名以便测试；但内部用 `useLocation` 需要测试环境有 `history`/`location`。方案：
- 保留 `renderWorkspace(search)` 纯入口（测试可传 search 字符串），内部 `useLocation` 支持注入（如 `useLocation(searchOverride)`）。
- 测试用 jsdom 的 `history.pushState`/`popstate` 模拟导航；`navigate` 通过 `WorkspaceShell` props 可注入 mock。
- 对 `window.location.assign` 的断言改为断言 `history.pushState` 被调 / URL search 更新。

## Risks / Trade-offs

- `useSyncExternalStore` 需要稳定快照，`URLSearchParams` 每次 `location.search` 变化才更新，避免死循环。
- 事件委托需排除非导航 `<a>`（如按钮内链接），用 `event.defaultPrevented` 与 `target` 判断。
- 测试改动量大（workspace/chat/tasks/packages/providers 均涉及 location），是本 change 主要成本。
