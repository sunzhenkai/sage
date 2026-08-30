# 验收证据 — sage-task-run-logs

浏览器验收时间：2026-08-30 02:00–02:07（本地栈：agent-api :9610 / agent-worker :9611 / agent-web :9612 / Postgres :15432 / Temporal :17233）。

| 文件 | 内容 |
| --- | --- |
| `run-logs-populated.png` | Task detail 运行日志面板：默认选中最新写入 attempt（尝试 2），2 行事件（run.started / run.failed），sequence 装订线、状态色事件徽标、等宽 payload 摘要、双语标签（zh-CN）。 |
| `run-logs-attempt-1.png` | 切换 attempt 后：尝试 1 的 7 行事件按 sequence 升序（run.started → run.completed），徽标覆盖 success/warning/info/neutral/danger 全部色调。 |
| `run-logs-390px.png` | `390×844` viewport：无横向溢出（`scrollWidth === clientWidth`，脚本断言通过）。 |
| `run-logs-empty-state.png` | 无 canonical 事件任务（legacy 路径执行）的本地化空状态。 |
| `package-run-offline-limitation.png` | 限制记录：github-trending 示例的数据源需外网抓取，离线沙箱内 run 准入被 `PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE` 拒绝；lifecycle-probe（无数据源）可正常发起并 Succeeded。 |

## 验收方法说明

- API 层：`GET /v1/tasks/:id/run-logs` 经 agent-web `/v1` 代理与直连 agent-api 均验证通过（含 404 `TASK_NOT_FOUND` 语义、attempt 索引 + 默认事件页、`selected`、`nextFromSequence`）。
- 运行事件来源：本地交互栈的任务内核执行使用进程内事件库（平台现状，canonical Postgres 权威库由 durable 链路与集成测试写入）。为完成写→读→UI 纵向验收，事件通过**生产写入契约**（`PostgresAgentAuthorityStore` fenced `appendEvent`，owner token `acceptance-writer`）写入刚真实执行完的任务 `pkg-80e6917b-a80d-46bf-be2a-a8e5b0dc634f`（attempt-1 成功 7 事件、attempt-2 失败 2 事件），未绕过任何读侧代码。
- 租户隔离与响应白名单由路由测试与 Postgres 集成测试覆盖（见 tasks.md 4.2）。
