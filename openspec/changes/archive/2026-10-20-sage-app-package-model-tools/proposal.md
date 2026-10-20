# sage-app-package-model-tools

## Why

MCP 与本地 CLI 仍以 Package 为中心；新模型下它们必须走 App 草稿与发布。方案见 `~/code/tasks/ongoing/sage-app-package-model/design/app-release-model.md` §9。

## What Changes

- MCP：删除 `package_list` / `package_get` / `package_register_release` 与 `app_upload_release`；新增 `app_update`、`app_get_draft`、`app_put_draft`、`app_publish_release`、`app_list_releases`；保留 `app_list/create/get/delete` 与 `run_create`。
- `ToolRequest` 支持透传 `If-Match` 头，供草稿/元数据写入使用。
- tool registry 删除 `package` 资源组，保留 `app` / `run` 组。
- CLI `scripts/register-package.ts` 改为：解析 `--app-id`（缺省取 `app.yaml` id）→ get-or-create App → PUT draft → POST publish，输出版本与 releaseId；移除对 `/v1/packages/*` 的调用。
- 更新 MCP registry 测试与 CLI 使用说明。

## Non-goals

- 不改 MCP 传输层协议与鉴权。
- 不新增独立 CLI 包；只改现有脚本与其 `package.json` alias。
- 不保留 `package_*` 或 `app_upload_release` 兼容别名（D-15）。

## 涉及面

| 仓库 | 角色 | 说明 |
|------|------|------|
| repos/github/sunzhenkai/sage | 必须 | `platform/apps/agent-api/src/mcp/*`、`scripts/register-package.ts`、`examples/ai-apps/README.md`（CLI 用法段） |

## 验收标准

- [x] `tools/list` 不再出现任何 `package_*` 或 `app_upload_release`；新增的 `app_*` 工具各有 registry 测试覆盖。
- [x] CLI 对一个本地示例目录执行成功，输出 `{ appId, version, releaseId }`；重复执行同内容返回 existing 而不报错。

## 验证记录

- `corepack pnpm --filter @sage/agent-api typecheck` → exit 0。
- `corepack pnpm --filter @sage/agent-api exec vitest run src/mcp/tools/registry.test.ts src/mcp/invoke.test.ts` → 14 passed（registry 8、invoke 6）。
- `corepack pnpm --filter @sage/agent-api exec vitest run src/mcp/mcp.integration.test.ts` → exit 0，7 skipped（未设置 `WORKSPACE_POSTGRES_URL`，集成套件按设计跳过）。
- 本地重建 `agent-api`/`agent-worker` 后连续两次执行：
  `corepack pnpm --filter @sage/agent-api register-package examples/ai-apps/lifecycle-probe --api-url http://127.0.0.1:9610 --auth local-dev-auth`
  两次均输出 `{ "appId": "lifecycle-probe", "version": "2.0.0", "releaseId": "sha256:6b10d135…" }`，第二次命中 existing（releaseId 相同，无报错）。
- `scripts/mcp-evidence.mjs` 同步移除 `package` 组与 `package_list` 调用。
