# Tasks — run-agent-settings

## 1. 契约与存储

- [x] 1.1 task-domain：新增 `RunAgentSettingsRecord`、`RunAgentSettingsStore`（`getRunAgentSettings`/`upsertRunAgentSettings`）并入 `TaskStorePort`，含单测
- [x] 1.2 task-store-postgres：迁移 `005_run_agent_settings.sql` + 读写实现 + 集成测试（无行=auto 语义、幂等 upsert、非法值由 API 层拒绝）

## 2. agent-api：设置路由与准入检查

- [x] 2.1 新增 `run-agent-settings-api.ts`：`GET/PUT /v1/run-agent/settings`（认证、严格字段、GET 附 env 非空检测的 provider 可用性、不回显 key），注册进组合根并接线 runtime
- [x] 2.2 runs-api 准入依赖检查：读设置，`minimax` 且 env 无 `MINIMAX_API_KEY` → 409 `PROVIDER_DEPENDENCY_MISSING`（不物化输入、不建任务）；补 runs-api 测试（minimax 拒绝 / auto / echo 放行）
- [x] 2.3 设置路由单测（读取含可用性、更新幂等、401/400 边界）

## 3. agent-worker：执行前检查与观测

- [x] 3.1 activities：package 输入按设置解析 harness（`echo` 显式 echo、`minimax` 缺 route 抛 `PROVIDER_DEPENDENCY_MISSING`、`auto` 现状），设置每 slice 现读；补 activities/runtime 测试
- [x] 3.2 runtime：启动 WARN（auto 无 key 回退时）、`/readyz` 携带 `providerMode`（live/echo + modelId，不含 key）；补 runtime 测试

## 4. web 设置入口

- [x] 4.1 agent-web Providers 页「运行 Agent」设置卡：默认 provider 下拉（auto/minimax/echo）+ 可用性展示 + locale 文案；补组件测试

## 5. 验证

- [x] 5.1 `pnpm typecheck`、相关包 `pnpm test` 全绿；`openspec validate run-agent-settings --strict` 通过
  - 验证记录（2026-08-25）：整仓 typecheck 通过；eslint（改动文件，--max-warnings=0）通过；全量 vitest 837 通过 / 4 失败——4 个失败均为既有问题（`source-loader.test.ts` 期望的 `missing-manifest` 夹具从未提交进 HEAD；`final.test.ts` 3 例为 openspec 子进程扫描超时，`buildPreflight` 实测 26s > 15s 硬编码预算，延长超时后其中 2 例通过），与本 change 改动文件无交集；新增测试全部通过（runs-api 7、settings API 4、worker runtime 12、web providers 7、store 集成 3 于真实 PG 临时库）
