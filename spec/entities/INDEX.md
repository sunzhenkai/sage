# 实体(entities/)

| 实体 | 身份 | 生命周期 | 页 |
|------|------|----------|-----|
| ChatSession | `session_id`(UUID) | 创建 → 流式聊天 → 关闭/归档 | [chat-session.md](chat-session.md) |
| TaskProjection | `task_id`(UUID) | 创建 → Workflow 调度 → 终态(成功/失败/取消) | [task-projection.md](task-projection.md) |
| AgentRun | `run_id`(UUID) | 启动 → Loop 推进 → 完成(成功/失败/超时) | [agent-run.md](agent-run.md) |
| AgentPackageRelease 记录 | `(package_id, version)` | 打包 → 签名 → Registry 登记 → 拒绝/接受 | [agent-package-release-record.md](agent-package-release-record.md) |
| ConsumptionLedger | `consumption_id` | 与 Effect 同步派生 | [consumption-ledger.md](consumption-ledger.md) |
| EffectLedger | `effect_id` | 提交 → 应用 → 不可改 | [effect-ledger-record.md](effect-ledger-record.md) |
