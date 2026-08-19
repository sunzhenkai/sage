## ADDED Requirements

### Requirement: Immutable Coordinator path and runtime snapshot
新 durable Task SHALL 在任何Coordinator start之前持久化不可变的lifecycle path、adapter identity、target reference、runtime compatibility reference、policy/registry versions、owner token与start idempotency key。Snapshot MUST 只含可信refs/identities而非Temporal SDK对象或untrusted raw endpoint；legacy Task继续使用既有`WorkflowTargetSnapshot`。

#### Scenario: Registry or adapter update after V2 start
- **WHEN** V2 Task启动后active Coordinator target、adapter build或registry entry发生变化
- **THEN** 已启动Task继续绑定原snapshot与compatible build policy，不随active值漂移

#### Scenario: Untrusted raw Coordinator target
- **WHEN** client、model或Package payload尝试提供raw endpoint、namespace、task queue或adapter build
- **THEN** admission拒绝或忽略该字段，并仅从trusted registry生成snapshot

### Requirement: Snapshot-bound Coordinator control and observation
Query、signal、pause、resume、cancel、retry、timeout处理与reconciliation SHALL 先读取持久snapshot和lifecycle path，再解析对应legacy Temporal client或新Coordinator Adapter。控制操作 MUST NOT根据当前默认路由、projection推测或fallback设置改发到其他path/target。

#### Scenario: Control after default path rollback
- **WHEN** 系统默认已从V2回退到legacy，而操作者cancel一个active V2 Task
- **THEN** cancel仍发送到该Task snapshot绑定的V2 Coordinator target

#### Scenario: Snapshot unavailable
- **WHEN** Task snapshot缺失、损坏或adapter/runtime ref不受支持
- **THEN** 控制操作fail closed并产生可审计错误，不向当前默认target发送猜测命令
