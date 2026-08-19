# Design

单一行为修复：`main.tsx` WorkspaceShell 中侧边栏 Chat 导航项由 `workspaceHref({ view: 'chat', ...(sessionId ? { sessionId } : {}) })` 改为 `workspaceHref({ view: 'chat' })`（即 `/`）。

- 品牌链接（首页）保持现状（仍保留 session）：品牌=「回到当前上下文」，列表入口由「对话」导航项与页头返回图标承担，两个入口职责清晰。
- Tasks/Providers 导航项不动，继续带 `session` query（任务提升/关联依赖该上下文）。
- 返回具体会话的路径：历史列表行、任务详情「前往对话」深链、浏览器后退。
