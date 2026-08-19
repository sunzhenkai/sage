# Design: align-workspace-header-info

## Context

`WorkspaceShell`（main.tsx）渲染全局 topbar：面包屑（Sage / 当前视图）、`localDevelopmentMode` 徽标、通知按钮、用户头像。各页面（chat/tasks/providers）在 content 内又渲染自己的 page-heading，信息重复。

## Goals / Non-Goals

- Goals：消除头部重复信息；用户区域移到左下角；对话页头部承载流连接状态、运行时与会话信息。
- Non-Goals：不改后端 API；不引入全局状态管理；不重做侧边栏导航。

## Decisions

1. **删除 shell 级 topbar**：`WorkspaceShell` 不再渲染 `<header className="topbar">`，`main-column` 直接是 `content-wrap`。头部信息唯一来源是各页面的 page-heading。
2. **用户区域下沉**：在 `sidebar-bottom` 增加用户账户行（头像 + 标签），复用原 `user-avatar` 样式；通知按钮随旧 topbar 一并移除（无实际功能）。
3. **对话页头部**：`ChatApp` 的 `chat-heading` 右侧 meta 区依次为：连接状态（live/connecting/offline）、运行时 provider chip（Local Pi Harness）、会话信息条（session id `<code>`、事件数、运行状态、打开任务工作区链接）。事件流面板 toggle 保留。
4. **任务页/服务商页**：保持现有 page-heading（任务统计+刷新 / 目录同步+新增），由于 shell topbar 移除，重复信息自然消除。
5. **本地化**：新增键 `openTaskWorkspace`（zh: 打开任务工作区 / en: Open task workspace）；`localDevelopmentMode` 保留用于侧边栏脚注（runtimeFootnote 已含），topbar 中不再使用。

## Risks / Trade-offs

- 现有测试未引用 breadcrumbs/topbar/user-avatar，风险低；相关 e2e 若断言 topbar 需同步更新（检查后无）。
- 移除 topbar 后页面顶部留白由 content-wrap padding 决定，视觉可接受。

## Migration Plan

纯前端渲染调整，一次性切换，无数据迁移。
