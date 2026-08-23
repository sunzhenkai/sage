# chat-user-interface Specification (delta)

## Purpose
本文件是 `chat-user-interface` capability 的增量 delta，记录客户端路由化对聊天界面导航语义的补充。既有需求（跨 Workspace 保留 session、侧边栏导航到列表等）行为不变，仅导航机制从整页跳转改为客户端路由。

## ADDED Requirements

### Requirement: 聊天导航走客户端路由

Chat 视图相关的所有站内导航（侧边栏 Chat 项、历史条目、任务→对话深链、返回列表链接）SHALL 通过客户端路由完成，不触发整页重载；跨视图 session 上下文保留的既有语义（Tasks/Providers 导航保留 `session` query、侧边栏 Chat 项不带 `session` query）保持成立。

#### Scenario: 任务详情深链返回会话
- **WHEN** 用户从任务详情点击「前往对话」深链
- **THEN** 携带原 `session` query 以客户端路由切换回对应 Chat session，不整页重载，展示同一 timeline
