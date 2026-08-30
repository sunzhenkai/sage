# 提案：移除 SAGE_FAKE_LIVE_PROVIDER 受信测试开关及配套 fake live provider 能力

## Why

`SAGE_FAKE_LIVE_PROVIDER=true` 曾用于让 Chat 与包运行在不依赖外部模型的情况下获得确定性回放输出（`已收到：<输入>`）。该开关属于生产 runtime 可达的隐藏旁路：本地开发栈一旦残留此环境变量，用户会误以为在调用真实模型，实际得到的是进程内替身回放，掩盖真实的 provider 行为与故障。延续「统一 provider 模型」变更确立的方向（chat/包运行一律 registry 引用路由，不存在离线/回声模式），现彻底移除该开关，使任何模型调用都只能经由真实 provider。

## What Changes

- 删除 `agent-api/src/runtime.ts` 与 `agent-worker/src/runtime.ts` 中对该环境变量的读取与 `createFakeLiveInvoker` 接线；`/readyz` 不再暴露 `providerExecution.mode` 字段。
- 删除 `compose.yaml` 中两处 `SAGE_FAKE_LIVE_PROVIDER` 条目；agent-api 服务改为可选透传 `SAGE_BOOTSTRAP_PROVIDER_*` 三项真实凭据。
- 删除完全依赖该开关的自动化套件 `ai-app-lifecycle.e2e.test.ts`、脚本 `pnpm test:ai-app-e2e` 及对应 capability 规格 `ai-app-lifecycle-e2e`；`examples/ai-apps/lifecycle-probe/` 测试源包保留，转为手工全链路验证样例。
- 重写 `scripts/smoke-local-stack.mjs`：移除 fake 强制注入与 readyz fake 断言；模型调用垂直链路（Chat→promotion→Task）改为真实凭据门控——未注入 `SAGE_BOOTSTRAP_PROVIDER_*` 时仅校验服务健康与 API 面，默认保持绿。
- `harness-pi` 的 `LiveProviderInvoker` 注入接缝保留：它仅作为纯单元测试与示例的显式 DI 边界存在，不再有任何从环境变量驱动的生产路径。

## Capabilities

### Modified Capabilities

- `local-stack-smoke-verification`: smoke 不再使用受信 fake 开关；垂直链路改为真实凭据门控，无凭据时验证服务健康与 API 面。

### Removed Capabilities

- `ai-app-lifecycle-e2e`: 该能力的两条 requirement 全部依赖受信 fake 开关提供的确定性回放，开关移除后不再可满足，整体删除。

## Impact

- 代码：`platform/apps/agent-api/src/runtime.ts`、`platform/apps/agent-worker/src/runtime.ts`、`platform/compose.yaml`、`platform/scripts/smoke-local-stack.mjs`、`platform/package.json`。
- 删除文件：`platform/apps/agent-api/src/ai-app-lifecycle.e2e.test.ts`。
- 文档：`platform/examples/ai-apps/README.md` 相关章节重写。
- 兼容性：曾以 `SAGE_FAKE_LIVE_PROVIDER=true` 运行的部署在升级后该变量被忽略（并最终消失）；需要无外部模型的全链路回归时改用各自包内的单元/DI 级测试替身。
- 冒烟语义变化：默认（无凭据）只做健康与 API 面验证；有真实凭据时才覆盖 Chat→promotion→Task 垂直链路。
