# Tasks — package-run-live-provider

## 1. 契约与存储

- [x] 1.1 task-domain：新增 `TaskRunOutputRecord`/`TaskRunOutputStore`，`TaskArtifactReference` 增加可选 `content`/`encoding`，`TaskStorePort` 纳入 output store
- [x] 1.2 task-domain：迁移 `004_task_run_output.sql`
- [x] 1.3 task-store-postgres：实现 `writeRunOutput`/`getRunOutput`（同键同容幂等、异容冲突），集成测试 roundtrip（P6_POSTGRES_URL 未设则跳过）

## 2. harness 与 worker

- [x] 2.1 harness-pi：`LiveProviderHarness` 支持 `systemPrompt` 覆盖与 `turnInput` 模式；单测覆盖（request.input → 单用户消息、chat 默认不变）
- [x] 2.2 local-runtime：`createLivePackageAgentClient` 工厂
- [x] 2.3 agent-worker：`readLiveProviderRouteFromEnv`（含单测：未配置 undefined、配置生成路由、base/model 覆盖、日志不含 key）+ runtime 装配 live/echo 客户端
- [x] 2.4 agent-worker activities：成功后写 run 输出（`outputStore` 可选注入，失败不阻断）

## 3. API 与超时

- [x] 3.1 agent-api runtime：装配 artifactResolver（task_run_output → 引用+内容，未命中回退引用）
- [x] 3.2 agent-api 单测：有内容/无内容两分支（沿 task-api.p6.test.ts 模式）
- [x] 3.3 temporal-workflows：活动超时 35s/2m → 5m/6m

## 4. 示例包与文档

- [x] 4.1 github-trending `app.yaml` modelRoute → minimax-cn / MiniMax-M3；smoke 测试断言同步；examples README 补 live provider 说明（env 变量表）
- [x] 4.2 展示页 `docs/showcase/github-trending.html` 模型信息同步（chip 与链路说明）

## 5. 验证与收尾

- [x] 5.1 `make typecheck` + harness-pi/worker/task-store/agent-api 相关 vitest 通过；既有套件无回归（既有 source-loader fixture 枚举失败除外，main 已存在）
- [x] 5.2 重启本地 agent-worker（env 带 MINIMAX_API_KEY 时为 live 模式）并重新登记 github-trending
- [x] 5.3 发起真实包 run：task succeeded 且 artifact 端点取回 MiniMax 生成的 digest；未配置 key 的回退路径抽查一次
- [x] 5.4 `openspec validate --strict` 通过；勾选验收标准、补验证记录、归档
