# agent-run-admission

## MODIFIED Requirements

### Requirement: 基于 Release 的运行 admission 与包输入物化
系统 SHALL 提供 `POST /v1/releases/{releaseId}/runs` 运行入口：从 registry resolve 不可变 Release，经服务端可信 admission 生成并持久化 canonical `AgentTaskSpec`（goalRef 指向所选 Task 的 entry prompt，model/skill/bounds 来自 manifest，principal/tenant 由服务端决定），签发只引用该 Spec 的 Envelope，并以既有确定性 workflowId 机制启动 durable workflow。请求体 SHALL 为 `{ task?, params?, taskId? }`：`task` 缺省解析为唯一任务（多任务未指定拒绝），`params` 按声明校验并取默认值，自由文本 `input` 字段 SHALL 以 `410 INPUT_REMOVED` 拒绝。发起时系统 SHALL 将「entry prompt + references + 输入快照（dataSources 声明，经 `package-run-input-resolution` 能力获取）+ 解析后参数 + promotion 物化输入（如有）」物化为该任务唯一的包输入记录（含资产 digest 清单），快照内容、来源 URL 与参数值纳入 `inputDigest` 与幂等 commandKey；快照获取按声明失败语义（fail 拒绝准入 / markMissing 标注继续）。`inputRef` 使用 `task-input://package/` scheme；重复提交相同解析输入 SHALL 幂等返回既有结果。production 模式下该端点 SHALL fail closed。

#### Scenario: 从包发起运行
- **WHEN** 客户端对已登记 Release 提交运行请求（含声明参数）
- **THEN** 系统生成 digest 一致的 Spec 与 Envelope、写入包输入记录并启动 workflow，返回 taskId

#### Scenario: 声明数据源的运行自动获取数据
- **WHEN** 客户端对声明了 dataSources 的 Task 提交运行请求（params 为空）
- **THEN** 准入先获取全部快照（按 onFailure 语义），物化的 assembled input 含快照与默认参数段，模型无需人工输入即拿到真实数据

#### Scenario: 参数或快照失败拒绝准入
- **WHEN** params 校验失败（400），或任一 `onFailure: fail` 的快照源获取失败（502）
- **THEN** 准入返回稳定错误码且不生成 Spec、不启动 workflow、不物化输入

#### Scenario: 相同输入幂等
- **WHEN** 同一 Release 同一 Task 的相同解析参数与相同快照内容被重复提交
- **THEN** admission 幂等机返回既有 Spec/运行，不产生新 Attempt；快照内容变化则 digest 不同、独立准入

#### Scenario: worker 解析包输入
- **WHEN** executeAgentSlice 收到 `task-input://package/{tenant}/{taskId}` 引用
- **THEN** resolver 返回物化的 assembled input；记录缺失时返回稳定错误且不回退其他输入源

#### Scenario: production fail closed
- **WHEN** 非 local 部署模式调用该端点
- **THEN** 返回 501 稳定错误，不生成 Spec、不启动 workflow
