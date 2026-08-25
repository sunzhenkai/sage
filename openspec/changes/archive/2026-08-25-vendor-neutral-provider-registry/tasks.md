# vendor-neutral-provider-registry — 任务

## 1. task-domain：枚举与常量收敛

- [x] 1.1 `platform/packages/task-domain`：`RunAgentDefaultProvider` 收敛为 `'echo' | 'connection'`；`DEPLOYMENT_ENV_MINIMAX_CONNECTION_ID` 改为 `deployment-env-default`（常量名同步去 vendor 化）；删除 `DEFAULT_MINIMAX_BASE_URL`/`DEFAULT_MINIMAX_MODEL` 或改为无 vendor 缺省（按调用方需要保留常量但不带 vendor 默认值）
- [x] 1.2 `PostgresTaskStore.getRunAgentSettings`：读取时将 legacy `auto`/`minimax` 归一为 `echo`（丢弃 `providerConnectionId`，不写回）；`tsc -b` 通过

## 2. agent-api：设置 API、准入与引导

- [x] 2.1 `run-agent-settings-api.ts`：`RunAgentDefaultProviderSchema` 收敛为 `echo|connection`；PUT 校验拒绝 `auto`/`minimax`；删除 `minimaxAvailableFromEnv` 与 `providerStatuses` 的 env 条目，可用性列表只含注册表条目
- [x] 2.2 `runs-api.ts` 准入检查：删除 `minimax`/env 分支，仅保留 `connection` 条目不可用拒绝（409 `PROVIDER_DEPENDENCY_MISSING`）与 `echo` 照常准入
- [x] 2.3 `provider-connections-api.ts`：`bootstrapDeploymentEnvProviderConnection` 改用 `SAGE_BOOTSTRAP_PROVIDER_API_KEY`（触发）+ 必填 `SAGE_BOOTSTRAP_PROVIDER_BASE_URL`/`SAGE_BOOTSTRAP_PROVIDER_MODEL`（缺失跳过并 WARN）+ 可选 `SAGE_BOOTSTRAP_PROVIDER_NAME`/`SAGE_BOOTSTRAP_PROVIDER_ADAPTER`（缺省 `anthropic`）；条目 id 用新常量，显示名缺省中性名；baseUrl 复用公共 HTTPS 校验；不再识别 `MINIMAX_*`

## 3. agent-worker：删除 env 路由

- [x] 3.1 `runtime.ts`：删除 `readLiveProviderRouteFromEnv`、`describeLiveProviderRoute`、`providerStatusOf`、`MINIMAX_*` 常量与 `packageAgentClient` 的 env 装配；启动 WARN 移除；`/readyz` 移除 `provider` 字段（保留 `secretBackend`）
- [x] 3.2 `activities.ts`：`decidePackageRunClientChoice` 的 `defaultProvider` 入参收敛为 `'echo' | 'connection'`；删除 `auto`/`minimax` 分支与相关 `PROVIDER_DEPENDENCY_MISSING` 文案中的 env 指引；connection 解析逻辑（`resolveConnectionLiveClient`）保持不变

## 4. agent-web：设置面去 vendor 化

- [x] 4.1 `providers.tsx`：默认 provider 下拉改为「离线模式 + 注册表条目列表」（`echo` / `connection:<id>`）；删除 `minimaxAvailableIn` 与 minimax 徽章分支；徽章只反映注册表条目状态，无可用条目时显示中性「无可用工作区 provider」并引导添加
- [x] 4.2 `locale.tsx`（en + zh-CN）：删除/改写 `providerOptionAuto`、`providerOptionMinimax`、`minimaxDetected`、`minimaxNotDetected` 等含 vendor 名或 env 变量名的文案；`providerOptionEcho` 改称「离线模式（不调用模型）」

## 5. 测试同步

- [x] 5.1 更新 `run-agent-settings-api.test.ts`、`runs-api.test.ts`、`provider-connections-api.test.ts`：枚举校验、legacy 归一、准入、引导（含缺 baseUrl/model 跳过、vendor 变量不生效）断言
- [x] 5.2 更新 `agent-worker` 的 `runtime.test.ts` 与 activities 相关测试：env 路由删除后的行为、`echo`/`connection` 决策表
- [x] 5.3 更新 `agent-web` 的 `providers.test.tsx` 与受影响的 chat 测试
- [x] 5.4 `corepack pnpm exec tsc -b --pretty false` 与相关包测试全绿

## 6. 文档与运维约定

- [x] 6.1 `platform/examples/ai-apps/README.md`：env 表改为 `SAGE_BOOTSTRAP_PROVIDER_*` + `SAGE_SECRET_MASTER_KEY`，去掉 `MINIMAX_*`
- [x] 6.2 `.service-manager.md`：agent-worker/agent-api notes 更新——worker 不再需要 provider key；启用 live 需注入 `SAGE_SECRET_MASTER_KEY`，可选完整引导变量组；给出部署模板样例
- [x] 6.3 全仓 grep 确认 `MINIMAX_API_KEY`/`minimax` 字样不再出现在 platform 源码（归档 openspec 与历史记录除外）
