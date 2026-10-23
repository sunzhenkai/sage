## Why

Chat 只能选择 provider 连接，无法选择模型：`ProviderConnection` 只绑定一个 `modelId`，Chat 提交/重试路由只接受 `{ connectionId }` 并固定使用连接的模型。同一供应商的多个模型只能靠重复创建连接（重复密封同一把 key）来区分。

## What Changes

- 连接新增 `models: string[]`（允许的模型 id）；`modelId` 保留为默认模型且恒属于 `models`。存量记录/行无 `models` 时按 `[modelId]` 解释。
- PostgreSQL 迁移 `009_provider_connection_models.sql`：`provider_connections.models text[]`（默认空数组，回填 `ARRAY[model_id]`）。
- `POST/PUT /v1/provider-connections` 接受可选 `models`（去重、非空、单个 ≤256 字符、含默认模型共 ≤64 个）；PUT 省略 `models` 时保留既有列表。
- Chat `POST …/messages` 与 `POST /v1/chat/runs/:runId/retry` 接受 `provider: { connectionId, modelId? }`；`modelId` 不在连接允许列表内以 `CHAT_INVALID_REQUEST` 拒绝，缺省用默认模型；仍拒绝内联路由与其他字段。
- `GET /v1/run-agent/settings` 的 `providers[]` 附带 `modelId` / `models`，供 Chat 模型选择器分组。
- 部署 env 引导新增可选 `SAGE_BOOTSTRAP_PROVIDER_MODELS`（逗号分隔）。
- MCP：`provider_connection_create/update` 增加 `models`，`chat_send_message/chat_retry_run` 的 provider 增加 `modelId`。
- agent-web：Providers 编辑框可增删模型、设默认（候选来自该供应商的 models.dev 目录，也可自由输入）；Chat 选择器按连接分组列出模型，显示 `连接名 / 模型`，提交与重试携带 `connectionId + modelId`；中英文文案。

## Capabilities

### New Capabilities
- `provider-connection-models`: 工作区 provider 连接的多模型允许列表与 Chat 按模型选择。

### Modified Capabilities
（无既有 spec 覆盖 provider 连接与 Chat 路由）

## Impact

- `platform/packages/task-domain`（记录/写入类型、`normalizeConnectionModels` / `connectionModels` / `resolveConnectionModel`、迁移 009）
- `platform/packages/task-store-postgres`（读写 `models` 列）
- `platform/packages/app-contracts`（`ChatProviderSelection.v2` 增加可选 `modelId`）
- `platform/apps/agent-api`（连接 API、Chat 路由、运行 agent 设置视图、部署 env 引导、MCP tools）
- `platform/apps/agent-web`（Providers 页、Chat 选择器、类型、mock、文案、README）
- 不改变包运行（manifest `modelRoute`）的连接解析：仍按连接默认模型匹配。
