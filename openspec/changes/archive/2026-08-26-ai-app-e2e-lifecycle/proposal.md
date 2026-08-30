# 提案：打通 AI App 创建、提交、运行、产物管理全链路

## Why

AI App 的「创建 → 提交 Release → 发起运行 → 产物查询」链路已分散落地于 apps-api、compiler、registry、runs-api、task_run_output 与 artifacts API，但缺少一条以真实 HTTP 入口走通全程的自动化端到端验证，链路缺口只能靠人工点选发现；同时代码库中缺少一个专为全链路验证设计、确定性输出、无外部依赖的测试 AI App。本地开发环境（api 9610 / worker 9611 / web 9612 / compose 基础设施）已在运行，具备直接验证条件。

## What Changes

- 新增一个测试 AI App 源包到 `platform/examples/ai-apps/`（参照 `github-trending/` 的目录即包结构：`app.yaml` + `prompts/` + 可选 `output.schema.json`），输出确定性、可断言，便于端到端校验。
- 新增自动化端到端验证：从 `POST /v1/apps` 创建 App 主体开始，经 `POST /v1/apps/:appId/releases` 提交编译登记、`POST /v1/releases/:releaseId/runs` 发起运行，到 `GET /v1/tasks/:taskId/artifacts` 取回产物并断言内容，覆盖完整生命周期。
- 运行验证在受信测试开关（`SAGE_FAKE_LIVE_PROVIDER=true`）下使用确定性 fake live provider，遵守 `local-stack-smoke-verification` 的既有约定；不引入真实外部模型依赖。
- 验证过程中发现的链路缺口（如 API 行为与 spec 不符、产物解析失败）以最小改动修复，并同步对应 spec delta。

## Capabilities

### New Capabilities

- `ai-app-lifecycle-e2e`: AI App 全生命周期端到端验证——测试 AI App 源包随库提供，自动化测试覆盖创建、提交、运行、产物管理四个阶段的串联行为与断言。

### Modified Capabilities

<!-- 当前无既有 requirement 变更；实现中若发现链路缺口导致 spec 级行为变化，再补充对应 delta。 -->

## Impact

- 代码：`platform/examples/ai-apps/`（新增测试 App）、`platform/apps/agent-api` 与相关包的测试（新增 e2e 用例）；如有缺口修复，涉及 `apps-api.ts` / `runs-api.ts` / `task-api.ts` / `run-output-resolver.ts` 等。
- API：不新增端点，仅验证既有 `/v1/apps`、`/v1/apps/:appId/releases`、`/v1/releases/:releaseId/runs`、`/v1/tasks/:taskId/artifacts` 行为。
- 依赖：无新增第三方依赖；测试复用 fake live provider 与本地开发 profile。
- 假设记录：测试 App 置于 `platform/examples/ai-apps/`（而非 fixtures），因该目录是示例源包的既有归属；「打通」界定为自动化端到端验证 + 缺口修复，而非重构链路。
