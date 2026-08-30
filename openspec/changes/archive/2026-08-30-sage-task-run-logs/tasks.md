# 任务：任务运行日志（Task Run Logs）

## 1. 读取端口与实现

- [x] 1.1 `platform-ports`：定义 `TaskRunLogQueryPort`（attempt 索引 + 事件分页读取）及类型
- [x] 1.2 `agent-state-postgres`：基于 `canonical_agent_events` 实现 attempt 索引查询与事件分页读取，附单元可测的 SQL 边界
- [x] 1.3 `local-fakes`：实现内存版 `TaskRunLogQueryPort` fake
- [x] 1.4 Postgres 集成测试：索引/分页/404 语义/租户隔离（沿用既有 integration 测试模式）

## 2. API 路由

- [x] 2.1 `agent-api/task-api.ts`：新增 `GET /v1/tasks/:taskId/run-logs`（鉴权、租户隔离、access-audit、strict typebox 响应 schema、错误码 TASK_NOT_FOUND / RUN_LOG_ATTEMPT_NOT_FOUND）
- [x] 2.2 runtime 组合根接线：local 模式用 Postgres 实现注入路由，测试可注入 fake
- [x] 2.3 路由测试：索引+默认页、指定 attempt 增量、404 语义、401/跨租户、响应白名单字段断言

## 3. 前端面板

- [x] 3.1 `agent-web/tasks.tsx`：run-logs 请求并入 detail 请求组（abort-token、刷新防重入、控制后随组刷新）
- [x] 3.2 运行日志面板 UI：attempt 选择器、事件日志行（sequence/类型/payload 摘要/引用计数）、加载更多、空状态；attempt 切换与加载更多的独立 token 防乱序
- [x] 3.3 `locale.tsx` 双语词条 + `styles.css` 日志样式（等宽 Data 角色、390px 无横向溢出）
- [x] 3.4 agent-web 测试：渲染快照、attempt 切换/加载更多交互、双语键集一致、stale token 不覆盖

## 4. 质量闸门与收尾

- [x] 4.1 `lint / typecheck / build` 全绿（workspace 级）
- [x] 4.2 既有 P4–P7/P8 相关回归（task-api、tasks web、conformance 相关用例）通过
- [x] 4.3 浏览器验收：本地栈起服务，真实任务产生运行事件后核对面板/隔离/空状态（截图入 evidence）
- [x] 4.4 `openspec validate --strict` 通过并归档 change
