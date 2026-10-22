# Tasks

## 1. MCP 工具

- [x] 1.1 重命名 `src/mcp/tools/package.ts` 为 `app.ts`，删除 `packageTools` 与 `app_upload_release`；新增 `app_update`（PATCH，可选 `ifMatch`）、`app_get_draft`、`app_put_draft`（PUT，可选 `ifMatch`）、`app_publish_release`（POST，body `{ baseRevision }`）、`app_list_releases`。验证：`registry.test.ts` 断言新工具存在且旧工具不存在
- [x] 1.2 扩展 `ToolRequest` 支持 `headers`，`createInjectExecutor` 合并这些头（保留 authorization）；路径参数做 `encodeURIComponent`。验证：新增 executor 单测断言 `If-Match` 被透传
- [x] 1.3 更新 `registry.ts`：导入新文件、从 `REQUIRED_GROUPS` 删除 `package`；确认 `app` / `run` 组仍满足覆盖断言。验证：`corepack pnpm --filter @sage/agent-api exec vitest run src/mcp/tools/registry.test.ts`

## 2. CLI

- [x] 2.1 改写 `scripts/register-package.ts`：支持 `--app-id`（缺省从 `app.yaml` 读取）；先 `POST /v1/apps`，409 `APP_ALREADY_EXISTS` 视为已存在；`GET /v1/apps/:appId/draft` 取 revision；`PUT /v1/apps/:appId/draft`（`If-Match: "r<N>"`）；`POST /v1/apps/:appId/releases`（`{ baseRevision }`）；输出 `{ appId, version, releaseId }`。验证：对 `examples/ai-apps/lifecycle-probe` 连续执行两次，第二次返回 existing
- [x] 2.2 更新脚本头部用法与 `examples/ai-apps/README.md` 的登记命令，移除 `/v1/packages` 与 `--package-id` 文案。验证：文档中不再出现 `/v1/packages` 或 `PackageReleaseResult.v1` 的 CLI 示例

## 3. 切片验证

- [x] 3.1 运行 `corepack pnpm --filter @sage/agent-api exec vitest run src/mcp/tools/registry.test.ts src/mcp/mcp.integration.test.ts` 与 `corepack pnpm --filter @sage/agent-api typecheck`，结果写入 `proposal.md` 验证记录。验证：命令 exit 0
