# 设计：AI App 全生命周期端到端验证

## Context

链路各段均已存在（见 proposal.md）：`apps-api.ts`（创建/提交）、`compiler.ts`（编译）、`agent-release-registry`（登记）、`runs-api.ts`（发起运行）、`task_run_output` + `task-api.ts` artifacts 端点（产物）。本地开发 profile 已在运行（api 9610 / worker 9611 / compose 基础设施），fake live provider 由 `SAGE_FAKE_LIVE_PROVIDER=true` 受信开关启用。已有先例：`sample-app.smoke.test.ts`、`github-trending.smoke.test.ts`（编译级冒烟）与 `reference-workload.integration.test.ts`（集成测试）。

## Goals / Non-Goals

**Goals:**

- 一个确定性测试 AI App 源包，可直接被 e2e 验证与人工演示复用。
- 一条自动化 e2e 验证，串联四个 HTTP 阶段并逐阶段断言，失败时能定位到具体阶段。
- 验证可在本地开发环境一键执行，且纳入既有测试命令体系。

**Non-Goals:**

- 不新增或修改对外 API 端点；链路缺口仅在验证发现后以最小改动修复。
- 不覆盖 Web UI（packages.tsx）的浏览器级验证。
- 不引入真实模型 provider；不验证生产治理路径（签名、SBOM、MinIO 治理流）。

## Decisions

- **测试 App 形态**：新增 `platform/examples/ai-apps/lifecycle-probe/`（`app.yaml` + `prompts/system.md` + `output.schema.json`），输出为固定 JSON（如 `{"probe":"ok","stages":["create","submit","run","artifact"]}`）。选择放 examples 而非 fixtures：examples 是源包的既有归属（github-trending 先例），fixtures 的 reference-workload 是另一种早期格式。替代方案（复用 ops-analyst）被否决：其输出语义面向演示，不适合硬编码断言。
- **e2e 验证实现位置与形态**：在 `platform/apps/agent-api` 下新增集成测试（Vitest），复用既有集成测试的本地栈连接约定（PG/Temporal 由 compose 提供，worker 以测试内或已运行实例执行）。选择集成测试而非扩展 `smoke-local-stack.mjs`：smoke 脚本面向整栈手工/CI 冒烟，集成测试能逐阶段断言并给出结构化失败信息。若既有集成测试基建要求 worker 进程内联，则沿用之，不起第二个 worker。
- **确定性来源**：运行路径的模型输出由 fake live provider 按测试 App 的 prompt/输入回放出固定内容；断言只比对 provider 承诺的固定输出，不假设 provider 内部实现。替代方案（断言宽松字段存在性）被否决：spec 要求内容级断言才能真正「打通产物管理」。
- **缺口修复策略**：先写测试再跑；任何 4xx/5xx 或断言失败先定位根因，最小修复并把 spec 级行为变化补回本 change 的 delta（Modified Capabilities），不做顺手重构。

## Risks / Trade-offs

- [集成测试依赖本地 compose 栈与已构建的 packages dist，环境未就绪时误报] → 测试前置检查依赖连通性，失败信息指明需 `make infra-up` 与构建步骤；文档化于 tasks 验证步骤。
- [fake provider 与真实 provider 行为漂移，e2e 通过但真实链路仍断] → 接受：本 change 边界内只保证受信测试开关下的确定性链路；真实 provider 路径由 `package-run-live-provider` 既有覆盖负责。
- [Temporal 运行终态等待引入偶发慢测试] → 轮询带显式超时与间隔上限，超时错误附带 taskId 与最近状态便于诊断。
