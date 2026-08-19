## Why

在 Chat 和 Task 入口接入前，Tool 安全、状态归属、Artifact/Secret 边界与关联观测必须具有统一语义。否则重试会重复副作用，敏感值会进入持久状态，且两条产品链路将无法一致诊断。

## What Changes

- 建立 Skill/Tool Registry 与默认执行管线：schema 校验、授权、执行、结果归一化、事件化。
- 实现 Agent Context、Session、Run、Checkpoint ports 及 PostgreSQL Agent State Adapter。
- 建立 Artifact 引用、CredentialProvider、`connection_ref`/`secret_ref` 与本地 fake/真实后端的相同契约。
- 引入 Tool 幂等键、timeout、重试分类与 `effect_unknown` 结果。
- 建立 Pino 与 OpenTelemetry/OTLP 统一 correlation 字段和敏感数据过滤。

## Capabilities

### New Capabilities
- `authorized-tool-execution`: fail-closed 的 Tool 授权、执行、幂等与未知副作用表达。
- `agent-state-and-artifact-boundaries`: Agent 状态、Checkpoint 与大结果 Artifact 引用的持久化边界。
- `credential-reference-isolation`: 仅以引用处理凭据并防止敏感值进入业务与观测数据。
- `correlated-agent-observability`: 可按统一 ID 关联的日志、Trace、Metric 与过滤规则。

### Modified Capabilities

- 无。

## Impact

新增安全/状态/Artifact/Credential/observability packages、PostgreSQL migration 和 Adapter contract tests；不提供默认 Shell、浏览器或不可信代码执行，也不将 Secret 值写入数据库。