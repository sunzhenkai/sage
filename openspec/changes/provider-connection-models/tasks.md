# Tasks

## 1. 领域与存储

- [x] 1.1 `task-domain` 增加 `models` 字段与 `normalizeConnectionModels` / `connectionModels` / `resolveConnectionModel`，补单测 — 验证：`connection-models.test.ts` 通过
- [x] 1.2 新增迁移 `009_provider_connection_models.sql` 并接入 `PostgresTaskStore.migrate()` — 验证：迁移单测断言可重入、加列与回填
- [x] 1.3 `task-store-postgres` 读写 `models`，PUT 省略时保留 — 验证：`provider-connections.integration.test.ts`（需 `CROSS_CHAIN_POSTGRES_URL`）

## 2. API

- [x] 2.1 连接 API 接受/校验/回显 `models`，部署 env 引导支持 `SAGE_BOOTSTRAP_PROVIDER_MODELS` — 验证：`provider-connections-api.test.ts`
- [x] 2.2 Chat 提交与重试接受 `{ connectionId, modelId? }`，越界模型与未知字段拒绝 — 验证：`chat-provider-route.test.ts`、app-contracts 单测
- [x] 2.3 运行 agent 设置视图附带 `modelId/models`；MCP tools 同步 — 验证：`run-agent-settings-api.test.ts`

## 3. Web

- [x] 3.1 Providers 编辑框模型列表（增删、设默认、目录候选 + 自由输入） — 验证：agent-web typecheck / check:design / build
- [x] 3.2 Chat 选择器按连接分组 `连接 / 模型`，提交与重试携带 `modelId`；中英文文案 — 验证：`connection-models.test.ts`、`locales.test.ts`

## 4. 验收

- [x] 4.1 `pnpm lint`、`pnpm typecheck`、`pnpm check:deps`、`pnpm test` — 验证：exit 0
- [ ] 4.2 本地栈（postgres）跑 `provider-connections.integration.test.ts` 与浏览器手测 — 验证：待有基础设施时补
