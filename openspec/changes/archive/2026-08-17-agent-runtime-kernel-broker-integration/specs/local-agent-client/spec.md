## MODIFIED Requirements

### Requirement: Shared local Agent invocation boundary
`LocalAgentClient` MUST 通过 public contract 为 Interactive 和 Durable Host 调用共享 Agent Runtime Kernel，并为每个调用方保留 immutable Spec/Envelope identity、cancellation、bounds/deadline、principal/tenant propagation、平台 Event、Run Receipt、checkpoint-reference 与 terminal-outcome 语义。v1 compatibility adapter 可以接受 `AgentRunSpec.v1`，但当 Kernel mode 是 authority 时，MUST 将其映射到同一 Kernel path，而不是实现独立 execution loop。

#### Scenario: Host 取消传播
- **WHEN** 调用方取消正在运行的 LocalAgentClient Run
- **THEN** Client 将同一 cancellation signal 转发给 Kernel，公开最终 cancellation terminal state，且不回滚已提交 receipts

#### Scenario: Checkpoint 引用转发
- **WHEN** Kernel 发出 sealed checkpoint reference
- **THEN** Client 原样转发该引用，不将其转换为 provider-specific state、secret payload 或 unsealed candidate

#### Scenario: Interactive 与 Durable 调用绑定
- **WHEN**API Host 与 Worker Host 构造相同 Spec/Envelope 的 LocalAgentClient 调用
- **THEN**两者进入同一 Kernel contract，且 Client 不根据 Host 类型复制 Model/Tool loop

## ADDED Requirements

### Requirement: Client feature flag 路由
`LocalAgentClient` composition MUST 支持默认 `legacy` 的 `legacy`、`shadow` 与 `kernel` 模式，并按受控环境、tenant 或 workload allowlist 选择路径。模式选择和实际 Kernel/Host/Engine build identity MUST 写入安全 telemetry 与 Run audit metadata。

#### Scenario: 默认未配置
- **WHEN**部署未配置 Kernel feature flag
- **THEN**Client 使用旧路径且不会意外创建新 Kernel authority records

#### Scenario: allowlist 外调用
- **WHEN**全局启用试点但当前 tenant/workload 不在 allowlist
- **THEN**Client 保持旧路径并记录未命中原因

### Requirement: Interactive shadow 不改变 authority
在 `shadow` 模式下，Client MUST 以旧路径作为唯一用户可见结果和 lifecycle authority；新 Kernel shadow MUST 使用独立 namespace 与无副作用、无真实结算 adapters，不得执行写 Tool、commit Consumption/Effect、finalize Artifact、seal Checkpoint、追加公共事件或覆盖旧路径状态。

#### Scenario: Shadow 遇到写 Tool proposal
- **WHEN**shadow Engine 提议写 Tool
- **THEN**shadow 跳过该调用并记录 `shadow_unsupported` 差异，不执行 Provider

#### Scenario: Shadow 结果不同
- **WHEN**shadow 与旧路径产生不同终态或事件摘要
- **THEN**用户仍只看到旧路径结果，系统仅记录脱敏差异指标

### Requirement: 旧路径回退遵守 commit barrier
在 `kernel` 模式下，Client 只有在任何 Effect、Usage、Artifact 或 Checkpoint authority commit 发生前且策略允许时才能回退旧路径。一旦越过 commit barrier，Client MUST NOT 自动重放旧路径，并 MUST 返回包含 receipt refs 的稳定可恢复或人工处置状态。

#### Scenario: 初始化失败回退
- **WHEN**Kernel 在调用任何 Broker 或 Store commit 前因可回退的初始化错误失败
- **THEN**Client 最多执行一次旧路径并记录结构化 fallback reason

#### Scenario: Model usage 已提交后失败
- **WHEN**Kernel 已提交 Usage Receipt 后发生错误
- **THEN**Client 不调用旧路径，并保留 Receipt 供 retry/resume 对账

### Requirement: Client 不暴露 Engine 或基础设施类型
`LocalAgentClient` public API MUST 只使用前序 change 定义的 canonical contracts 与兼容 DTO，MUST NOT 暴露 Pi、MCP、Temporal、provider、数据库或 Ledger driver 类型。

#### Scenario: Public API dependency scan
- **WHEN**静态检查扫描 Agent Client 导出类型及其传递依赖
- **THEN**不存在具体 Engine、Coordinator 或基础设施 SDK 类型
