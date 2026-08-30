# Tasks: remove-fake-live-provider-switch

## 1. 生产 runtime 移除开关

- [x] 1.1 `agent-api/src/runtime.ts`：删除环境变量读取、`createFakeLiveInvoker` import 与条件接线，readyz 移除 `providerExecution`
- [x] 1.2 `agent-worker/src/runtime.ts`：删除 `fakeInvoker`、invoker 透传与 readyz `providerExecution`

## 2. 配置与验证设施

- [x] 2.1 `compose.yaml`：删除两处 `SAGE_FAKE_LIVE_PROVIDER` 条目，agent-api 增加 `SAGE_BOOTSTRAP_PROVIDER_*` 可选透传
- [x] 2.2 删除 `ai-app-lifecycle.e2e.test.ts` 与 `package.json` 的 `test:ai-app-e2e` 脚本
- [x] 2.3 重写 `scripts/smoke-local-stack.mjs`：去 fake 注入与断言，垂直链路按 `SAGE_BOOTSTRAP_PROVIDER_*` 门控

## 3. 文档与规格

- [x] 3.1 重写 `platform/examples/ai-apps/README.md` 中 fake 开关与端到端章节为手动验证说明
- [x] 3.2 标记 `ai-app-lifecycle-e2e` 规格为 REMOVED（specs delta）
- [x] 3.3 更新 `local-stack-smoke-verification` 规格 delta（MODIFIED Requirement: Repeatable local stack smoke test）

## 4. 验证

- [x] 4.1 受影响包 `@sage/agent-api`、`@sage/agent-worker`：`tsc -b` 通过；vitest 套件 136 passed / 1 skipped
- [x] 4.2 生产代码与配置全库确认无 `SAGE_FAKE_LIVE_PROVIDER` 残留（活跃规格 `openspec/specs/*` 待本 change 归档时按 delta 同步移除）
- [x] 4.3 `compose.yaml` 校验通过（`docker compose config --quiet`）；冒烟脚本语法通过（`node --check`）；`openspec validate --strict` 通过
- [ ] 4.4 （遗留，非本变更引入）workspace 级 `pnpm typecheck` 在 `examples/p3-integration`、`p4-integration`、`p5-integration` 失败：仍引用 936907b 已删除的 `agentClient` 选项，待单独任务迁移
