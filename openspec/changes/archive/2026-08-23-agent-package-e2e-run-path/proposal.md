## Why
「从包发起运行」是整条链路的闭环点：没有它，包只能被注册和浏览，不能执行。当前 `/v1/tasks` 不生成 Spec、inputRef 仅支持 chat 格式，包运行需要新的 admission 入口与输入物化机制。

## What Changes
- agent-api 新增 `POST /v1/releases/{releaseId}/runs`：resolve Release → 复用 `agent-run-admission` 生成并持久化 `AgentTaskSpec`（goalRef=entry prompt、skillRefs/modelRoute/bounds 来自 manifest）→ 签发 Envelope → 复用 `TrustedMultiTargetTaskController` 启动既有 `AgentTaskWorkflow`
- 新表 `task_package_input`：发起时把「entry prompt + references 清单 + 用户输入」物化，`inputRef = task-input://package/{tenant}/{taskId}`
- agent-worker 新增 `PackageTaskInputResolver`（与 ChatTaskInputResolver 并列），既有 chat 路径不动
- 端到端集成测试：登记示例包 → 发起运行 → workflow 推进 → artifact/投影可查

## Capabilities

### New Capabilities

（无）

### Modified Capabilities
- `agent-run-admission` — ADDED「基于 Release 的运行 admission 与包输入物化」requirement

## Non-goals
- 不修改 `POST /v1/tasks` 既有行为；不接 V2 coordinator
- 不实现 production admission 门（production 模式下新端点 fail closed 返回 501）

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | agent-api、agent-run-admission、agent-worker、task-store-postgres（新表 migration）、openspec specs |

## 验收标准
- [x] 发起运行产出 canonical Spec（digest 一致、create-only 持久化）与 Envelope，并以确定性 workflowId 启动
- [x] 物化输入表写入与 `task-input://package/` 解析可用；重试/重投不产生重复执行授权
- [x] e2e 测试走通：注册包 → run → succeeded → projection/artifact 可查
- [x] production 模式 fail closed；lint/test 通过

## 验证记录

- `pnpm typecheck`（全仓）：通过
- 单测：`packages/agent-run-admission/src/release-run.test.ts` 5/5、`apps/agent-worker/src/runtime.test.ts` 7/7、`apps/agent-api/src/runs-api.test.ts` 5/5
- 受影响包单元测试合计 155/155 通过（agent-run-admission / agent-release-registry / task-domain / task-store-postgres / agent-worker / agent-api）
- e2e：`P6_POSTGRES_URL=... SAGE_TEMPORAL_ADDRESS=127.0.0.1:17233 npx vitest run examples/p6-integration/src/package-run.e2e.test.tsx` — 1/1 通过（登记 → 发起运行 → workflow succeeded → projection 可查 → 幂等重投返回 existing）
- `npx eslint` 全部新增/修改文件通过；`node scripts/check-dependencies.mjs`：Dependency boundaries OK
- `openspec validate --strict --type change agent-package-e2e-run-path` 通过
- 实现说明：
  - 新 migration `packages/task-domain/migrations/003_task_package_input.sql`，`PostgresTaskStore` 新增 `writePackageInput/getPackageInput`
  - `agent-run-admission` 新增 `release-run.ts`（Release→Spec 映射 + 幂等 + create-only putSpec + envelope）与 `package-input.ts`（拼装器）
  - `agent-api` 新增 `runs-api.ts`（`POST /v1/releases/{releaseId}/runs`，production 501 fail closed），runtime 接线
  - `agent-worker` 新增 `PackageTaskInputResolver` + `CompositeTaskInputResolver`（chat 路径不动）
  - 编译器 asset lock 携带 manifest 摘要与资产内容，供运行期物化输入；registry 新增 `getStoredRelease` 暴露 lockPayload
