# Tasks

- [x] 1. `main.tsx`：侧边栏「对话」导航链接改为 `workspaceHref({ view: 'chat' })`（不带 session）
- [x] 2. `header-alignment.test.tsx`：新增断言——session 视图下侧边栏「对话」href 为 `/`，「任务」「服务商」链接保留 `session` query
- [x] 3. typecheck / lint / agent-web vitest 全绿
- [x] 4. `openspec validate chat-sidebar-list-navigation --strict` 通过；重建 agent-web 容器后 Playwright 验证侧边栏点击回到列表；归档
