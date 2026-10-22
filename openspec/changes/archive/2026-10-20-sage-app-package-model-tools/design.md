# Design — sage-app-package-model-tools

## 背景

MCP tool registry 与本地 CLI 仍映射已删除的 `/v1/packages*`。新模型下 App 是唯一管理对象，工具面必须收敛到 App 元数据、草稿与发布。

## 决策

### 1. 工具组重命名与收敛

`src/mcp/tools/package.ts` 改为 `app.ts`，只保留 `app` 与 `run` 两组：

| 工具 | 端点 |
|------|------|
| `app_list` / `app_create` / `app_get` / `app_delete` | `/v1/apps*` |
| `app_update` | `PATCH /v1/apps/:appId`（可选 `ifMatch`） |
| `app_get_draft` | `GET /v1/apps/:appId/draft` |
| `app_put_draft` | `PUT /v1/apps/:appId/draft`（可选 `ifMatch`） |
| `app_publish_release` | `POST /v1/apps/:appId/releases`（body `{ baseRevision }`） |
| `app_list_releases` | `GET /v1/apps/:appId/releases` |
| `run_create` | `POST /v1/releases/:releaseId/runs` |

删除 `package_list` / `package_get` / `package_register_release` / `app_upload_release`，不保留兼容别名（D-15）。`REQUIRED_GROUPS` 删除 `package`。

路径参数统一 `encodeURIComponent`，避免 appId/releaseId 中的特殊字符破坏注入路径。

### 2. ToolRequest 透传请求头

`ToolRequest.headers` 承载 tool 生成的 `If-Match`；`createInjectExecutor` 以 `{ ...request.headers, authorization }` 合并，调用方 authorization 最后写入，保持鉴权权威。`ToolRequest.method` 增加 `PATCH`。

### 3. CLI 走 App 草稿发布链

`register-package.ts` 保持“扫描目录 → 服务端编译”的既有边界：

1. `POST /v1/apps`（`409 APP_ALREADY_EXISTS` 视为已存在）；
2. `GET /v1/apps/:appId/draft` 取当前 revision；
3. `PUT .../draft`，`If-Match: "r<N>"`；
4. `POST .../releases`，`{ baseRevision: <put 后 revision> }`；
5. 输出 `{ appId, version, releaseId }`。

同版本同内容重复执行由 registry 幂等返回 existing；CLI 不额外判断。`--package-id` 改为 `--app-id`，缺省读取 `app.yaml` 的 `id`。
