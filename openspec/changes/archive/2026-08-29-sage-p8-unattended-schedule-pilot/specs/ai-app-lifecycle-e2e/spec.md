# ai-app-lifecycle-e2e（delta）

## ADDED Requirements

### Requirement: Schedule 触发纳入端到端验证
AI App 全生命周期端到端验证 SHALL 覆盖 schedule 触发路径：注册 AI App → 登记 Release → 创建绑定该 Release 的 schedule → 产生触发（压缩时钟或显式 due）→ admission 生成新 `AgentTaskSpec` → durable run 完成 → task 投影、schedule 触发历史与预算账户可见且一致。验证 MUST 断言 FIXED 绑定在 Release 更新后不漂移，并可断言 overlap/misfire 与失败触发（依赖不可用 fail closed）路径。

#### Scenario: 定时触发全链路走通
- **WHEN** 以测试 AI App 源包执行 schedule 路径端到端验证
- **THEN** 触发生成的 task/spec/run 与投影、触发历史、预算账户记录一一对应且内容可断言

#### Scenario: 绑定不漂移可断言
- **WHEN** 验证过程中登记新 Release 并使 rollout policy 切换 active
- **THEN** FIXED 绑定 schedule 的后续触发 Spec 仍引用原 digest，断言通过
