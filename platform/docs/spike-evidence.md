# P0 Pi 与 Temporal 兼容性 Spike

## 重现

```bash
cd platform
corepack pnpm install --frozen-lockfile
corepack pnpm spike:pi
corepack pnpm spike:temporal
# 启动 Compose 后：
corepack pnpm spike:temporal:integration
```

## Pi 0.73.1

`pi-capabilities.test.ts` 使用 Pi 自带 faux provider，无网络或模型密钥：验证 Adapter 注入只读 Skill 上下文、原生事件顺序、AbortSignal 取消，以及把 transcript 保存为版本化 checkpoint 后在新 Agent 中恢复。

结论：**P1 PROCEED WITH ADAPTER**。Pi 原生提供 Agent/Event/transcript/abort，但不提供 Sage 的 Skill Registry、稳定公共事件、durable Session、checkpoint 或 pause/resume。`sessionId` 只用于 provider cache affinity；`continue()` 只延续当前内存 transcript。上述能力必须由 `agent-lib`/`harness-pi` 持有，公共契约不得暴露 Pi 类型。checkpoint 只在 turn/tool committed boundary 创建，并在保存前脱敏、限长和引用化。若 Pi 迁移失败，替换 `HarnessPort` Adapter，不改变公共契约。

## Temporal SDK 1.22.0

`temporal-capabilities.test.ts` 实际调用 `bundleWorkflowCode`，验证 Workflow 可 bundle 且不包含 Agent Library/Node fs。`temporal-integration.ts` 连接 Compose 中已注册的 `sage-dev` Namespace，启动带 `sage-p0-build-1` 的 Worker，执行 Workflow、抓取 13 条 History event，并通过 `Worker.runReplayHistory`。`temporal-mtls.test.ts` 生成一次性 CA/server/client 证书，以强制客户端证书的 gRPC stub 验证 NativeConnection 正向连接，并验证缺少客户端证书时拒绝。

结论：**P4 PROCEED**。Workflow 必须只含确定性编排，LLM、Tool、网络、数据库、Artifact 和 Secret I/O 全部进入 Activity。P4 必须在现有真实 History replay 基础上新增负向 nondeterminism、Activity retry 与 Worker restart 测试。`WorkerOptions.buildId` 在 SDK 1.22 已 deprecated，仅作为 P0 bundle identity 兼容性证据；生产采用 Worker Deployment (`workerDeploymentOptions`) 前需单独验证 rollout/ramp/pinned 行为。mTLS 的真实 LB、证书链和 Namespace RBAC 仍需目标环境 smoke test。失败时保留 Temporal Client/Worker Adapter 边界，不允许 API 本地降级执行。

## 已知限制

- 离线 Pi Spike 不调用真实模型，不证明 provider 速率、token usage 或模型质量。
- bundle 测试不等同于生产 replay；P4 将 fixture 和负向 nondeterminism 测试纳入 gate。
- 本地 Compose 的凭据和单节点拓扑不可用于生产。
