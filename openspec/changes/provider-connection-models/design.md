## Context

连接是「端点 + 凭据 + 模型」三元组，凭据密封在 `provider_credentials`。Chat 在提交边界由 `connectionId` 解析出本次 Run 的内存路由（`LiveProviderRoute`），模型取自连接。

## Goals / Non-Goals

- Goals：一个连接（一把 key）可服务多个模型；Chat 可逐条消息选择模型；存量数据与旧客户端无感兼容。
- Non-Goals：包运行 manifest `modelRoute` 按 `models` 匹配（需要 worker 侧同时传递所选模型，另行处理）；Chat Run 记录持久化所用模型（`ChatRun.v1` 未含模型字段）。

## Decisions

- **默认模型 + 允许列表**：保留 `modelId` 作为默认，新增 `models`；读取统一经 `connectionModels(record)` 归一（默认模型恒在首位并去重），因此存量记录、空数组、旧二进制改了 `model_id` 但未改 `models` 的行都自洽。
- **存储**：`models text[] NOT NULL DEFAULT '{}'`，迁移回填 `ARRAY[model_id]`；不加 `model_id = ANY(models)` 约束，避免滚动发布期间旧二进制写入失败——不变式由读取归一保证。
- **PUT 省略 `models` = 保留**：存储层 `COALESCE($models, models)`，旧 Web/MCP 客户端只改元数据时不会清空模型列表。
- **校验位置**：API 层给出明确错误文案（`PROVIDER_CONNECTION_INVALID_REQUEST`）；存储层用同一 `normalizeConnectionModels` 兜底拒绝非法写入。上限 64 个、单个 ≤256 字符。
- **Chat 路由**：`modelId` 校验在连接存在且启用之后、解密凭据之前；不在允许列表 → `CHAT_INVALID_REQUEST`（400，客户端可修正），与条目不可用的 `CHAT_PROVIDER_DEPENDENCY_MISSING`（409）可区分。解析出的模型写入本次 Run 的 `LiveProviderRoute.modelId`。
- **Web 选择器数据源**：沿用 `GET /v1/run-agent/settings`（已有可用性），在 `providers[]` 中附带 `modelId/models`，避免 Chat 页再拉一次连接列表。选项键为 `connectionId\nmodelId`（连接 id 由服务端生成，不含换行）。

## Risks / Trade-offs

- 旧版 agent-web 仍只发 `{ connectionId }`，行为不变（默认模型）。
- 新版 agent-web 对接旧版 agent-api：`providers[]` 无 `models` 时回退为每个连接一项、只发 `connectionId`。
- 用户删除某模型后，已打开的 Chat 页若仍选中该模型，提交会得到 `CHAT_INVALID_REQUEST`；选择器在设置刷新后自动回退到默认连接的默认模型。
