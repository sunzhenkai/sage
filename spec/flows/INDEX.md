# 处理线(flows/)

| 处理线 | 触发 | 输出 | 页 |
|--------|------|------|-----|
| Chat 短请求 Agent Run | 用户在 Web 提交一条短 Chat | 流式消息/工具/Artifact + Run 终态 | [chat-short-run.md](chat-short-run.md) |
| Chat 长请求提升为 Temporal Task | 用户提交 Chat,agent-api 判定为长请求 | Temporal Workflow + Task Card + Worker 推进 | [chat-elevated-task.md](chat-elevated-task.md) |
| AgentPackageRelease 准入 | 开发者提交新 AgentPackage | Release 接受/拒绝 + Registry 登记 | [release-admission.md](release-admission.md) |
