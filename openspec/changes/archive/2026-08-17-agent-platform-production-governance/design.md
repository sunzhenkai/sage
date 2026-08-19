## Context

**T0005 强制交付链**：1 `agent-platform-contract-authority-foundation` → 2 `agent-runtime-kernel-broker-integration` → 3 `durable-agent-coordinator-adapter` → 4 `agent-package-release-admission` → 5 `agent-platform-production-governance` → 6 `agent-platform-generalization-validation`。本 change 是序列第 5 项；仅在全部前序项完成、strict validation、delta specs 同步且实现/验收 Gate 通过后才可实施和验收。任一适用 Gate 未满足时本项为 `NO-GO`，后序项不得消费未冻结成果。

本 change 是 T0005 架构优化的 Phase 4、交付序列第 5 项。它只在 `agent-platform-contract-authority-foundation`、`agent-runtime-kernel-broker-integration`、`durable-agent-coordinator-adapter`、`agent-package-release-admission` 依次完成、同步并通过 gate 后实施；前置产物分别提供 canonical Spec/Receipt/Checkpoint authority、共享 Kernel/Broker 与 Consumption Ledger、Coordinator History lifecycle authority，以及 Package/Release/Admission。当前 P7 仅有本地工程控制和演练模板，生产 OIDC、workload identity、Secret Manager、HA 存储、具名 Owner 与真实批准仍缺失，因此当前结论必须继续是 `NO-GO`。

此 change 横跨 Security、Platform、SRE、Release、Data 与 Runtime Owner。关键约束是：Engine、Package、Skill、MCP metadata 和外部内容均不可信；控制只能单调收窄已签发 Spec；跨 Effect、Usage、Artifact 与 Checkpoint 不宣称全局 exactly-once；外部依赖不可用不能降级为放行；canonical packages 不依赖具体云厂商 SDK。

## Goals / Non-Goals

**Goals:**

- 建立 principal→Admission→Spec scope→workload identity→per-call authorization 的生产身份链，并确保 Secret bytes 只有 Secret Manager 持有。
- 让 Capability Grant、Approval、Tool Effect Ledger 与 Consumption Ledger 成为可测试、可审计、fail-closed 的生产 authority。
- 让 Artifact/Checkpoint 在跨 PostgreSQL 与对象存储故障下不产生可消费悬空引用，并满足 tenant ACL、加密、retention 和恢复完整性。
- 对 generic/infrastructure Tool、Release、Adapter、Provider 建立 sandbox/egress 与供应链准入。
- 冻结 SLO、HA/PITR/RTO/RPO、容量、公平性、backpressure、retry storm、关联观测、kill switch 与 Go/No-Go 证据门。

**Non-Goals:**

- 不选择某个云厂商的 OIDC、Secret Manager、KMS、容器 sandbox 或制品签名产品；以 ports 和 conformance contract 隔离。
- 不把普通 Package 扩展为可执行原生代码，不开放任意 shell、SQL、数据库或 HTTP 给模型。
- 不实现跨 Effect/Usage/Artifact/Checkpoint 的分布式全局事务，也不承诺外部业务副作用 exactly-once。
- 不以本地 fake、shadow、AI review、文档模板或未具名审批替代生产证据，不在本 change 自动打开生产流量。
- 不改变 Coordinator History、AgentTaskSpec、Ledger、Artifact/Checkpoint 各自已冻结的 authority 边界。

## Decisions

### 1. 用显式前置 Gate 而非隐式代码依赖表达阶段顺序

实现入口首先检查四个前置 change 的同步状态、conformance/replay gate 与生产配置 schema。任何缺项都使 production profile 拒绝启动或 Admission 拒绝签发 Envelope，并在 readiness 与 Go/No-Go 证据中报告稳定原因。选择显式 Gate 是因为包依赖只能证明代码存在，不能证明 authority 迁移、数据 backfill 与运维证据已完成；替代方案“按模块可编译即继续”会允许半迁移 authority 进入生产。

### 2. 身份与 Secret 使用短期、受众绑定的交换链

Edge 验证 OIDC issuer、audience、signature、expiry、nonce/重放约束，将可信 `principal_ref` 与 `tenant_id` 交给 Admission；Admission 固化 scope 而不保存 bearer token。Host 以绑定 tenant、workload、environment、audience 和短 TTL 的 workload identity 调用 Broker；Broker 按调用解析 credential reference，Secret Manager 返回的 bytes 仅存在于受控 Adapter 内存并在使用后清除。禁止长寿命静态 Secret 和将调用方自报 claims 当作 authority。选择 token exchange/workload identity 而非共享服务账号，以缩小泄露半径并支持逐 workload 撤销。

### 3. RLS 与应用 ACL 双层执行，引用不是授权

所有 tenant-owned PostgreSQL 表启用强制 RLS，并由连接事务设置不可伪造的 tenant/principal context；对象存储、Checkpoint、Artifact、Context 和业务 refs 在服务层再次校验 tenant、scope、sensitivity 与 purpose。后台 reconciler 使用独立最小权限角色，逐 tenant 分片且每次访问都记录审计。选择 defense-in-depth 而非只靠应用过滤；跨租户 URI 即使 digest 合法也必须拒绝。

### 4. Grant snapshot 加 live 单调收窄 overlay

每次 Tool 的有效权限为：

```text
Spec Grant Snapshot
∩ live deny/revocation overlay
∩ principal/tenant/resource scope
∩ approval binding and expiry
∩ Consumption Ledger available budget
```

Policy、Revocation、Approval、Ledger 或 identity verification 任一不可用/超时均拒绝写调用；仅可由显式、版本化策略定义少量低风险只读应急行为。overlay 只允许 deny、缩小 scope 或 kill，不允许增加 Tool/Provider/route。每次授权生成 receipt，记录输入 digest、决策版本与原因。相比缓存 allow-until-refresh，此方案优先阻止撤销窗口内的越权。

### 5. Approval 绑定 canonical intent 而不是 UI 文本

Approval digest 覆盖 tenant、principal、tool/provider build、canonical input digest、risk class、resource scope、allowed count/cost、environment、issued/expiry 和 approver policy。Broker 执行前重新规范化参数并比较 digest；参数、版本、scope、principal、tenant 或过期时间任一变化都要求重新批准。Approval 只授权一次语义动作或明确的有界集合，不能作为通用 bearer capability。

### 6. Tool Effect Ledger 采用 claim/fence/commit 状态机

`semantic_action_id = hash(tenant_id, task_id, attempt_compatible_action_key, tool_version, canonical_input_digest)`；Ledger 以 tenant+action 为唯一键并保存 input digest、provider build、fencing token、状态与 receipt。Broker 在外部写前原子 claim；已 `COMMITTED` 且 digest 相同直接 replay，digest 不同返回 conflict；执行后以 fence 提交结果。超时或响应丢失且 provider 无法按 idempotency key 查询时写 `EFFECT_UNKNOWN`，Coordinator 与 Kernel 禁止自动 retry。

人工 resolution 必须由与原执行者职责分离的授权主体记录证据，选择 `CONFIRMED_COMMITTED`、`CONFIRMED_NOT_COMMITTED` 或 `ABANDONED`；只有确认未提交后，策略才能签发新 action/fence。选择独立 Ledger 而非 Event/Task projection，因为后两者不是副作用结果 authority。

### 7. Consumption Ledger 使用 reservation/receipt 事务，不依赖本地余额

每个可硬约束调用先以稳定 invocation ID 原子 reserve upper bound，再执行 Model/Tool，随后以 immutable usage receipt digest commit actual 并 release unused。相同 digest replay 幂等，不同 digest conflict；超时 reservation 只能由带 lease/fence 的 reconciler 在确认无有效执行后 expire/release。retry/resume 必须读取权威余额。热点 account 按 tenant/account 分区并限制并发，Ledger 不可用时禁止产生受预算约束的消费。

### 8. Artifact/Checkpoint 使用 temporary→metadata pending→finalize→visible 协议

先写加密 temporary object 并校验 digest，再在 PostgreSQL 写 `PENDING` metadata/outbox，finalizer 以 fence 将对象 promote 并原子标记 `COMMITTED`；只有 committed 状态可签发或解析 ref。响应丢失时按稳定 object/action ID 查询；reconciler 清理孤儿 temporary、完成可证明的 finalize，并把无法判断的记录隔离为人工处置。Checkpoint 额外校验 Spec、sequence、Engine codec、runtime compatibility 与 Effect/Usage lineage 后 seal。对象与 metadata 使用 tenant-scoped envelope encryption、key rotation、legal hold 和 retention tombstone；删除以可审计状态机覆盖副本与备份生命周期。

不采用先返回 URI 后异步上传，因为这会制造悬空引用；也不要求数据库和对象存储 2PC，因为其可用性、产品支持和故障恢复成本不可控。

### 9. Sandbox/egress 在解析与连接两个时点校验

bounded generic Tool 在非特权、只读根文件系统、最小 syscall/capability、CPU/内存/进程/时间/输出限制的隔离执行器运行。网络默认拒绝，通过受控 egress proxy 按 scheme/host/port/path/provider policy allowlist；禁止 userinfo、非预期 redirect、link-local/loopback/private/reserved/metadata IP。DNS 解析由可信 resolver 完成，连接时对实际目标 IP 重新校验并 pin，redirect 每跳重复验证，以阻断 SSRF 与 DNS rebinding。基础设施 Tool 默认不对 Agent 暴露。

### 10. 供应链验证是发布、Admission 和执行三道门

Release、Engine/Model Adapter、Capability Provider 构件必须内容寻址，并携带受信签名、provenance、SBOM、license/vulnerability 结果与兼容声明。Registry publish 校验一次，Admission 针对精确 digest 和当前撤销/策略再校验，Host 在加载时验证 digest/attestation，防止发布后替换。撤销立即阻止新 Admission；对运行中构件由 kill switch 按风险停止新 invocation、drain 或 cancel，不静默切换 build。选择三道门以覆盖 Registry、Admission cache 与运行节点被分别攻破的风险。

### 11. SRE 控制以 admission pressure 为首要保护面

每个生产组件定义 availability/latency/correctness SLI、错误预算、故障域副本、PITR 与经演练的 RTO/RPO。Admission 按 tenant 加权公平队列、并发/预算 quota 和 queue age 执行 backpressure；Worker/Provider 使用 bounded exponential backoff、jitter、retry budget、circuit breaker 与 global concurrency cap，禁止无界 retry storm。kill switch 支持 global、tenant、Release、Provider、Tool 和 model route scope，动作可审计且只能阻止新工作或请求受控 cancel，不能删除已提交 authority 数据。

### 12. 观测相关性与数据最小化同时强制

trace/log/audit 传播 tenant/session/task/run/attempt/spec/invocation/model/tool/action/artifact/checkpoint/workflow IDs；高基数 ID 不进入 metrics labels。安全审计记录 identity、grant、approval、policy、effect/usage、resolution、supply-chain 和 kill-switch 决策；普通 telemetry 不记录 token、Secret、完整 Context、Tool body 或敏感 Artifact。Dashboard/alert 覆盖 admission、fairness、queue、Ledger、`EFFECT_UNKNOWN`、orphan、reconcile、provider、checkpoint/artifact 与 SLO burn rate，并链接具名 Owner 与 Runbook。

## Risks / Trade-offs

- [Policy/Revocation/Ledger 依赖故障会降低可用性] → 写操作及受硬预算消费 fail closed；多 AZ、短超时、只读缓存仅可承载显式低风险 deny-safe 路径，并以 SLO/演练验证。
- [Effect Ledger 无法消除不支持幂等/查询的外部系统不确定性] → Provider contract 强制 idempotency/query 能力分级；无法确认时进入 `EFFECT_UNKNOWN` 和职责分离人工 resolution，绝不自动重试。
- [RLS 管理员/后台角色可能绕过租户隔离] → 强制 RLS、独立 migration/reconcile role、逐 tenant transaction context、break-glass 审批与跨租户负向测试。
- [Artifact/Checkpoint 跨存储协议存在长时间 pending] → outbox/fencing/reconciler、状态可观测、age SLO、隔离队列和人工处置；引用仅在 committed 后可见。
- [供应链扫描结果和撤销会阻断紧急发布] → 预先批准、时限化且具名的 break-glass 流程仍必须签名/审计，并默认不绕过 critical policy；事后复核不能替代执行前控制。
- [严格 sandbox 与 egress 降低通用 Tool 能力] → 优先建设强类型 semantic Provider；确需 generic Tool 时使用显式高风险审批和更窄的环境/网络 profile。
- [高基数关联增加日志与审计成本] → metrics 仅用有界维度，详细 ID 进入采样 trace 和不可篡改审计；安全/Effect/Approval 记录不采样。
- [Phase 4 范围较大] → 按以下 migration waves 独立 gate，任何 wave 失败停止新生产 Admission，不回滚已提交 Ledger/Artifact/Checkpoint authority。

## Migration Plan

1. **Prerequisite gate**：验证四个前置 change 已完成/sync；运行 canonical conformance、Coordinator replay、Release/Admission 与 Ledger migration preflight。缺项即保持 `NO-GO`。
2. **Schema and shadow**：部署 RLS、Grant/Approval、Effect/Usage、Artifact/Checkpoint commit/outbox、审计 schema 与只读 reconcilers；对现有流量 shadow 计算决策，不授予新权限、不产生副作用或结算。
3. **Identity and secret canary**：在隔离 tenant 接入 OIDC、workload identity、Secret Manager、KMS；验证 token replay/audience、rotation、跨 tenant、Secret 泄露扫描和依赖故障 fail-closed。
4. **Ledger and storage canary**：先对新 Attempt 启用 Consumption reservation 与 Artifact/Checkpoint 原子 commit，再对写 Tool 启用 Effect Ledger；执行 timeout、响应丢失、duplicate、conflict、orphan 和 reconcile 故障注入。
5. **Sandbox and supply chain gate**：启用 egress proxy/sandbox 和 publish/admission/load 三段验证；演练 SSRF、DNS rebinding、redirect、签名撤销、Provider/Adapter kill 与无静默替换。
6. **SRE readiness**：完成多 AZ/PITR、备份恢复、RTO/RPO、容量/公平性、backpressure/retry storm、provider outage、kill switch 和 alert/runbook 演练，记录具名 Owner 与时间戳证据。
7. **Human Go/No-Go**：Security、Architecture、Operations、Release/Data Owner 逐项签署。仅所有 gate 为通过或有明确、时限化残余风险接受时开放有界生产 canary；否则保持 `NO-GO`。
8. **Rollback**：停止新生产 Admission，触发 scope kill/drain，将尚未执行的 reservation release；不得删除或改写 committed Effect/Usage、sealed Checkpoint、Artifact 或旧 Spec。代码回退仅接管尚未开始的新工作，运行中 Attempt 按兼容策略完成、暂停或人工处置。

## Open Questions

- 生产 Identity Provider、Secret Manager、KMS、对象存储和签名透明日志的具体产品、region 与 accountable Owner 是谁？
- 每类数据和 Artifact 的 sensitivity、residency、retention、legal hold 与备份删除期限是多少？
- 各组件最终 SLO、tenant fairness 权重、quota、RTO/RPO、capacity headroom 与错误预算阈值是多少？
- 哪些外部 Provider 支持真正的 idempotency key 与 effect query；不支持者是否允许进入生产写 capability allowlist？
- `EFFECT_UNKNOWN` resolution 的审批角色、SLA、证据格式和 break-glass 轮值如何落地？
- 哪些 low-risk read-only Tool 在 Policy/Revocation 局部故障时允许 deny-safe 降级；默认答案保持“无”？

所有未决项都必须在具名 Owner 决策并形成生产证据前保持对应 gate 未满足，不得以默认值推导 `GO`。
