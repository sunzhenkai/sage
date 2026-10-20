# explore 纪要（自问自答）

## Q1：schedules 走固定 principal，写审计的 actorRef 怎么定？
- 推荐：用 runtime 现有的 `config.principal`（`principalId: local-dev-principal`），与 packages/apps/runs 一致；审计照常记录，后续用户登录落位后换成登录主体。
- 依据：`runtime.ts:206` 已为 tasks/packages/apps/runs 注入同一 principal。

## Q2：internal `schedule-dispatch` 是否也放开？
- 推荐：不放开，继续 `SAGE_SERVICE_TOKEN_HASHES` + `SAGE_SERVICE_TOKEN`；它是 worker→api 的服务间调用，不是浏览器链路。
- 依据：`runtime.ts:279-284`、`agent-worker/src/schedule-runtime.ts:34`、`compose.yaml:106`。

## Q3：前端 `serviceToken` 字段保留还是删除？
- 推荐：从「连接」页删除；MCP 设置区保留 API key 的展示/编辑/复制/测试，改名为 API key，并单独存 `mcpApiKey`。
- 依据：连接页说明“Required for schedules”已不成立；MCP 仍需要同一把 key。

## Q4：全局 401 提示 `tokenRequired` / `addToken` 还留吗？
- 推荐：删除自动加 Bearer 与“需要服务令牌 / 添加令牌”提示；401 走通用错误展示。后续用户登录再重新设计。
- 依据：`components/ui/misc.tsx:74-86` 把任何 401 都解释成 token。

## Q5：是否需要数据库/表结构迁移？
- 推荐：不需要。
- 依据：只改鉴权接线与前端设置字段（localStorage 旧 `serviceToken` 迁移为 `mcpApiKey`）。

## 未决
- 无。
