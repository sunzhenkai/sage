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
- [ ] 发起运行产出 canonical Spec（digest 一致、create-only 持久化）与 Envelope，并以确定性 workflowId 启动
- [ ] 物化输入表写入与 `task-input://package/` 解析可用；重试/重投不产生重复执行授权
- [ ] e2e 测试走通：注册包 → run → succeeded → projection/artifact 可查
- [ ] production 模式 fail closed；lint/test 通过

## 验证记录
