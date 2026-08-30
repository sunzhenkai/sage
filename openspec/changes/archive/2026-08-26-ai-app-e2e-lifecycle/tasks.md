# 任务：打通 AI App 创建、提交、运行、产物管理

## 1. 测试 AI App 源包

- [x] 1.1 新增 `platform/examples/ai-apps/lifecycle-probe/`：`app.yaml`（符合 `AgentSourceManifest.v1`）+ `prompts/system.md`，无 references 与 output.schema.json 以保证输出确定性、可精确断言
- [x] 1.2 为 lifecycle-probe 增加编译级冒烟测试（参照 `sample-app.smoke.test.ts`），验证编译通过且产出不可变 Release
- [x] 1.3 更新 `platform/examples/ai-apps/README.md`，登记 lifecycle-probe 的用途与运行方式

## 2. 端到端生命周期验证

- [x] 2.1 在 `platform/apps/agent-api` 新增 e2e 基建（`ai-app-lifecycle.e2e.test.ts`）：`SAGE_AI_APP_E2E=1` 显式启用，preflight 校验 api/worker `/readyz` 的 `providerExecution.mode=fake`；本地栈 agent-api/agent-worker 已注入 `SAGE_FAKE_LIVE_PROVIDER=true` 重启
- [x] 2.2 实现 e2e 用例阶段一：`POST /v1/apps` 创建 App 主体并断言响应（含幂等清理与 409 回退）
- [x] 2.3 实现阶段二：读取 lifecycle-probe 源包文件，`POST /v1/apps/:appId/releases` 提交编译登记并断言 Release 字段
- [x] 2.4 实现阶段三：`POST /v1/releases/:releaseId/runs` 发起运行，轮询任务至终态（带显式超时与诊断信息）并断言成功
- [x] 2.5 实现阶段四：`GET /v1/tasks/:taskId/artifacts` 与产物详情端点，断言产物引用存在且解析内容等于固定期望输出（`已收到：<组装输入>`）
- [x] 2.6 每阶段失败时给出标明阶段与响应摘要的断言错误（`stage()` 包装 + preflight 明确报错）

## 3. 缺口修复与收尾

- [x] 3.1 运行 e2e 验证，定位并最小修复发现的链路缺口：**真缺口**——`runs-api.ts` 在幂等命中（`existing`）时响应回填的是本次请求新生成的幻影 `taskId/runId/attemptId`，导致重放后查询任务 `TASK_NOT_FOUND`；已改为回填首次准入 spec 中的原始 id（包输入物化与 `controller.create` 仅在 `admitted` 时执行），并新增单元测试覆盖自动生成 taskId 的幂等重放。另修复测试接线缺口：`github-trending.smoke.test.ts` 此前未纳入 `@sage/agent-package-release` 的 test 脚本。均为与既有文档（README 幂等语义）对齐的 bug 修复，无 spec 级行为变化
- [x] 3.2 将 e2e 验证纳入既有测试命令（platform `package.json` 新增 `test:ai-app-e2e`），并在 `platform/examples/ai-apps/README.md` 文档化前置条件（本地栈、构建 dist、fake provider 开关）
- [x] 3.3 全量回归：typecheck 无新增错误（仅 examples/ p3/p4/p5 六个既有遗留错误）；`pnpm test` 仅 2 个既有失败（`agent-platform-final/final.test.ts`、`node-host` budget 用例，已在干净工作区复现确认与本次改动无关）；agent-api 19 个测试文件 106 用例全过；改动文件 lint 通过；e2e 连续多次通过（含幂等重放路径）
- [x] 3.4 `openspec validate ai-app-e2e-lifecycle --strict` 通过
