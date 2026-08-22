## ADDED Requirements

### Requirement: 基于 Release 的运行 admission 与包输入物化
系统 SHALL 提供 `POST /v1/releases/{releaseId}/runs` 运行入口：从 registry resolve 不可变 Release，经服务端可信 admission 生成并持久化 canonical `AgentTaskSpec`（goalRef 指向包 entry prompt，model/skill/bounds 来自 manifest，principal/tenant 由服务端决定），签发只引用该 Spec 的 Envelope，并以既有确定性 workflowId 机制启动 durable workflow。发起时系统 SHALL 将「entry prompt + references + 用户输入」物化为该任务唯一的包输入记录（含资产 digest 清单），`inputRef` 使用 `task-input://package/` scheme；重复提交相同输入 SHALL 幂等返回既有结果。production 模式下该端点 SHALL fail closed。

#### Scenario: 从包发起运行
- **WHEN** 客户端对已登记 Release 提交运行请求（含用户输入）
- **THEN** 系统生成 digest 一致的 Spec 与 Envelope、写入包输入记录并启动 workflow，返回 taskId

#### Scenario: 相同输入幂等
- **WHEN** 同一 Release 与相同用户输入被重复提交
- **THEN** admission 幂等机返回既有 Spec/运行，不产生新 Attempt

#### Scenario: worker 解析包输入
- **WHEN** executeAgentSlice 收到 `task-input://package/{tenant}/{taskId}` 引用
- **THEN** resolver 返回物化的 assembled input；记录缺失时返回稳定错误且不回退其他输入源

#### Scenario: production fail closed
- **WHEN** 非 local 部署模式调用该端点
- **THEN** 返回 501 稳定错误，不生成 Spec、不启动 workflow
