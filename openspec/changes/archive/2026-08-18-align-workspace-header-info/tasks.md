# Tasks: align-workspace-header-info

- [x] 1. `main.tsx`：WorkspaceShell 移除 topbar（面包屑、本地开发模式、通知、用户头像）；用户账户行移入 sidebar-bottom。
- [x] 2. `chat.tsx`：ChatApp 头部 meta 区加入会话信息（id、事件数、运行状态、打开任务工作区链接），与连接状态、运行时 chip 并列。
- [x] 3. `tasks.tsx` / `providers.tsx`：确认头部无重复信息（shell topbar 移除后），必要时微调头部布局。
- [x] 4. `locale.tsx`：新增 `openTaskWorkspace` 等键（zh/en）。（核实后已存在，无需新增）
- [x] 5. `styles.css`：移除 topbar/breadcrumbs 相关样式，新增 sidebar 用户行与会话信息条样式；更新响应式规则。
- [x] 6. 更新/补充测试并跑通 agent-web 测试套件；`openspec validate align-workspace-header-info` 通过。
