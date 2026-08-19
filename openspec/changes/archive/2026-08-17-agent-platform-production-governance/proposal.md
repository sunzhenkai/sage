## Why

**T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 5 项；仅在全部前序项完成、strict validation、delta specs 同步且实现/验收 Gate 通过后才可实施和验收。任一适用 Gate 未满足时本项为 `NO-GO`，后序项不得消费未冻结成果。

前三个序列 change 已冻结 canonical authority、闭合 Kernel/Broker、泛化 durable Coordinator，第 4 个 change 正在建立 Package/Release/Admission，但生产环境仍缺少真实身份与 Secret、租户隔离、可即时撤权的授权、写副作用与硬预算 authority、原子 Artifact/Checkpoint、供应链准入及可演练的韧性控制。作为 Phase 4、交付序列第 5 项，本 change 必须把这些生产控制闭环；在前置 change 或任一生产依赖、证据、人工审批未完成时，系统必须 fail closed 且生产状态保持 `NO-GO`。

本 change **明确依赖且仅在以下四个 changes 按顺序完成、delta specs 同步并通过各自 gate 后实施**：`agent-platform-contract-authority-foundation`（Phase 0，序列 1）、`agent-runtime-kernel-broker-integration`（Phase 1，序列 2）、`durable-agent-coordinator-adapter`（Phase 2，序列 3）、`agent-package-release-admission`（Phase 3，序列 4）。

## What Changes

- 将生产 OIDC human/service principal、短期 workload identity 与 Secret Manager 接入认证、Admission 和每次 Broker 调用；Secret bytes 不进入 Spec、History、Event、Checkpoint、Artifact metadata、日志、trace 或 projection。
- 对控制面、Ledger、Artifact、Checkpoint、Context 和业务引用实施 tenant RLS/ACL 与跨租户拒绝；有效 Tool 权限严格等于 Spec grant snapshot、live deny/revocation、principal/tenant/resource scope、approval 和权威预算的交集，任一依赖不可用即 fail closed。
- 新增 capability grant 治理：Approval 绑定 tenant、principal、Tool/Provider build、规范化参数 digest、risk、scope 与 expiry；live overlay 只能收窄/kill，MCP discovery 不授予权限。
- 将 Tool Effect Ledger 定义为写副作用唯一 authority；以稳定 `semantic_action_id` 管理 prepare/execute/commit/replay/conflict，未知提交进入 `EFFECT_UNKNOWN` 并停止自动 retry，只有审计化人工 resolution 才能继续。
- 生产化 Consumption Ledger 的 reservation/commit/release/expiry/orphan recovery；余额与结算以 Ledger 为 authority，相同 receipt 幂等、不同 digest 冲突，retry/resume 不依赖 Kernel 本地计数。
- 生产化 Artifact/Checkpoint 的 body+metadata 原子 commit、temporary/finalize/outbox/reconcile、digest/ACL/lineage 校验、加密与 retention/deletion；禁止悬空引用和猜测恢复。
- 对 bounded generic/infrastructure Tool 实施隔离 sandbox、资源上限、默认拒绝 egress、目标 allowlist、代理解析与连接时 IP 再校验，阻断私网/metadata endpoint、SSRF、DNS rebinding 与重定向逃逸。
- 将 Release、Engine/Model Adapter、Capability Provider 纳入签名、provenance、SBOM、漏洞、license、撤销与兼容策略；未签名、签名无效、已撤销或不合规构件不得发布、Admission 或执行。
- 建立生产 SLO、HA、故障域、PITR、RTO/RPO、备份恢复和发布/回滚演练；增加容量、公平性、backpressure、drain、stuck run、retry storm、orphan cleanup 及 provider 熔断控制。
- 统一关联 tenant/session/task/run/attempt/spec/invocation/model/tool/semantic action/artifact/checkpoint/workflow IDs，覆盖 grant、approval、budget、effect、reconcile 与 provider health；提供按 tenant/Tool/Provider/Release 的 kill switch，并保证已提交 authority 数据不被回滚。
- 扩展生产 Go/No-Go gate：前四个 changes、生产后端、SLO/恢复证据、供应链验证、故障注入和具名安全/架构/运维审批任一未满足，均阻止新生产 workload；本地 fake、shadow 或文档模板不得作为生产证据。

## Capabilities

### New Capabilities
- `capability-grant-governance`: 定义生产身份链、租户/资源 scope、Grant snapshot、Approval digest/scope/expiry、live deny/revocation、sandbox/egress 与 fail-closed 授权语义。
- `tool-effect-ledger`: 定义写副作用唯一 authority、稳定 `semantic_action_id`、幂等 replay、digest conflict、`EFFECT_UNKNOWN` 和人工 resolution protocol。

### Modified Capabilities
- `authorized-tool-execution`: 将写 Tool 执行约束为 Grant/Approval/Effect Ledger 前置授权和提交协议，并补充 sandbox、egress、SSRF、DNS rebinding 与 kill switch 防护。
- `consumption-ledger`: 将 Phase 1 的硬预算 Ledger 扩展为生产级 reservation/commit/release/expiry、幂等 conflict 与 orphan recovery authority。
- `production-data-and-secret-governance`: 增加 OIDC/workload identity、Secret Manager、tenant RLS/ACL、跨租户引用拒绝、加密和 retention/deletion 要求。
- `agent-state-and-artifact-boundaries`: 增加 Artifact/Checkpoint 原子 commit/finalize/reconcile、seal/lineage、加密、retention 与恢复完整性要求。
- `agent-package-release`: 将 Release、Engine/Model Adapter 与 Capability Provider 纳入签名、provenance、SBOM、漏洞、license、撤销和兼容供应链 gate。
- `agent-run-admission`: 要求生产 Admission 校验身份、tenant、Grant/Approval、供应链、初始预算与生产依赖健康，任何缺失均不签发可执行 Envelope。
- `production-pilot-resilience`: 增加 SLO、HA/故障域、PITR、RTO/RPO、容量、公平性、backpressure、retry storm、drain 与 kill switch 演练要求。
- `production-task-observability`: 扩展跨 Spec/Grant/Approval/Ledger/Effect/Artifact/Checkpoint/Provider 的关联、审计、告警与高基数约束。
- `pilot-go-no-go-governance`: 把前四个 change、生产依赖、供应链、恢复/容量/安全演练和具名人工批准设为强制准入 gate；未完成时保持 `NO-GO`。

## Impact

- 主要影响 `agent-api`、`agent-worker`、`agent-lib`、`tool-runtime`、`agent-state-postgres`、`platform-ports`、`provider-catalog`、Temporal Adapter、Release Registry、Admission Compiler、PostgreSQL migrations、对象存储、可观测配置和 P7 运维证据。
- 新增或接入生产 Identity Provider、workload identity、Secret Manager、Policy/Revocation/Approval 服务、Effect/Consumption Ledger、KMS/加密对象存储、供应链验证器及其 fail-closed health contracts；具体云厂商通过 Adapter 隔离。
- 新增稳定的 Grant/Approval/Effect/Usage/Resolution receipts、RLS policies、reconcile workers、kill switch、SLO/容量/恢复 dashboard、alert 和 Runbook；canonical contracts 不引入具体 OIDC、Secret Manager、KMS 或容器运行时 SDK 类型。
- 这是高影响生产安全变更，必须分阶段 shadow/canary、故障注入和人工审批；不自动开启生产流量，不把旧 P7 本地演练或 fake 解释为生产就绪。
