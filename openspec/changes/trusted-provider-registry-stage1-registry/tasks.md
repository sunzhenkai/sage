# Tasks — trusted-provider-registry-stage1-registry

## 1. 契约与存储

- [ ] 1.1 新包 `platform/packages/secret-vault`：`SecretBackend` 接口（`seal`/`open`/`describe`）+ `LocalAesGcmSecretBackend`（`SAGE_SECRET_MASTER_KEY` base64 32B；缺 key/长度错抛稳定错误）+ 单测（round-trip、篡改密文失败、随机 IV、缺主密钥 fail-closed）
- [ ] 1.2 task-domain：`ProviderConnectionRecord`（含 `source`、`credentialPresent` 派生布尔）、凭据密封记录契约、`ProviderConnectionStore` 端口（list/getById/create/update/setEnabled/sealCredential/delete，删除返回引用阻挡信息）并入 `TaskStorePort`；`RunAgentSettingsRecord` 扩展 `providerConnectionId`（可空）；契约级单测
- [ ] 1.3 task-store-postgres：迁移 `006_provider_connections.sql`（`provider_connections` + `provider_credentials` 两表、级联删除、仅 id 唯一）+ 实现与集成测试（同 provider 多条目、级联删除凭据、列表不含密文）

## 2. agent-api：注册表 API 与 env 引导

- [ ] 2.1 新增 `provider-connections-api.ts`：GET/POST/PUT/DELETE（认证、公共 HTTPS baseUrl 校验、未知字段拒绝、apiKey 写通道专用不回显、DELETE 被 settings 引用 409 `PROVIDER_CONNECTION_IN_USE`、deployment-env 条目 DELETE/改名 409 `PROVIDER_CONNECTION_PROTECTED`）；注册进组合根
- [ ] 2.2 env 引导：runtime 装配时 `MINIMAX_API_KEY` 非空且 SecretBackend 可用则幂等 upsert `deployment-env-minimax` 条目（凭据密封自 env；缺 master key 或 env 缺失跳过 + WARN 不阻塞启动）；补测试
- [ ] 2.3 run-agent-settings API 扩展：PUT 接受 `{ defaultProvider, providerConnectionId? }`（组合校验、指向存在且启用条目）；GET `providers[]` 改为注册表 enabled+凭据在场条目 + legacy minimax env 检测；响应不含密文；更新单测
- [ ] 2.4 runs-api 准入扩展：connection 模式条目缺失/停用/凭据缺失 → 409 `PROVIDER_DEPENDENCY_MISSING`（不物化输入、不建任务）；补 runs-api 测试

## 3. agent-worker：执行边界解析

- [ ] 3.1 activities/runtime：按设置分派——connection 模式在 slice 执行边界从注册表取条目 + SecretBackend 解密构造路由；缺失/停用/无凭据/后端不可用抛不可重试 `PROVIDER_DEPENDENCY_MISSING`；payload/事件只含条目 id；legacy 路径行为不变；补测试

## 4. agent-web：工作区 provider 面板与设置卡

- [ ] 4.1 Providers 页新增「工作区 provider」面板：条目列表（名称、provider/model、source 徽标、凭据在场、启停、删除）+ 新建/编辑表单（apiKey 写后即忘）+ locale（中英）
- [ ] 4.2 「运行 Agent」卡：下拉加入启用条目（选中 → connection 模式）；徽章按模式显示（connection=条目凭据状态；legacy minimax 保持 env 文案）；locale 与测试更新

## 5. 验证

- [ ] 5.1 `pnpm typecheck` 全绿；受影响包测试全绿（secret-vault、task-domain、task-store-postgres 集成、agent-api、agent-worker、agent-web）；eslint 改动文件 `--max-warnings=0` 通过；`openspec validate --strict --type change trusted-provider-registry-stage1-registry` 通过
