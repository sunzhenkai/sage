# 处理线(flows/)

| 处理线 | 触发 | 输出 | 页 |
|--------|------|------|-----|
| Chat 短请求 Agent Run | 用户在 Web 提交一条短 Chat | 流式消息/工具/Artifact + Run 终态 | [chat-short-run.md](chat-short-run.md) |
| Chat 长请求提升为 Temporal Task | 用户提交 Chat,agent-api 判定为长请求 | Temporal Workflow + Task Card + Worker 推进 | [chat-elevated-task.md](chat-elevated-task.md) |
| AgentPackageRelease 准入 | 开发者提交新 AgentPackage | Release 接受/拒绝 + Registry 登记 | [release-admission.md](release-admission.md) |
| Schedule 定时触发运行(P8) | Temporal Schedules 按 cron/interval 到期 | durable Run + append-only 触发事件/预算 | [schedule-triggered-run.md](schedule-triggered-run.md) |
| 无人值守失败裁决(P8) | 失败告警路由到 oncall | `/v1/effects/resolutions` 裁决:retry 新 attempt / Ledger replay / terminate | [unattended-failure-resolution.md](unattended-failure-resolution.md) |
