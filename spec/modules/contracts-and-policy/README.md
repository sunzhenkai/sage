# contracts-and-policy

跨包共享契约、Production Governance、Secret Vault。`agent-contracts` 与 `app-contracts` 用 TypeBox 写 Schema;`platform-ports` 用 TypeScript interface 写 Port;`production-governance` 写边界/遥测/计费的硬约束与 P8 无人值守运行面(pilot-gate、failure-taxonomy);`secret-vault` 解封密钥。

## 根

| 路径前缀 | 角色 |
|----------|------|
| `platform/packages/agent-contracts` | Agent 共享 Schema(TypeBox) |
| `platform/packages/app-contracts` | 应用层共享 Schema(schedules/resolutions wire 契约) |
| `platform/packages/platform-ports` | Port 接口与 ReferenceEnvelope(Schedule canonical 契约) |
| `platform/packages/production-governance` | Production 边界检查 + 无人值守失败自治 |
| `platform/packages/secret-vault` | Secret 解封 |

## 文件(agent-contracts)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | TypeBox Schema 聚合 | — |
| `production-governance.ts` | Production Governance Schema | `governanceSchema` |
| `index.test.ts` / `production-governance.test.ts` | 测试 | — |

## 文件(app-contracts)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 应用层 Schema;P8 新增 `ApiSchedule*.v1` 家族(trigger/overlap/misfire/releaseBinding/budget/targetConstraints)与 `ApiEffectResolutionSubmit.v1`、`EffectResolutionResult.v1` | `ApiScheduleDefinitionSchema` |
| `index.test.ts` | 测试 | — |

## 文件(platform-ports)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Port 接口、ReferenceEnvelope、RuntimeCorrelation;P8 新增 Schedule canonical 契约(`ScheduleDefinition`/`ScheduleSnapshot`/`ScheduleControlStore`)与快照校验 | `assertScheduleSnapshot` |
| `runtime.ts` | RuntimeCorrelation 工具 | — |
| `schedule.ts` | 调度抽象(canonical 契约,不泄漏 Temporal 类型) | `ScheduleControlStore` |
| `coordinator-conformance.ts` | Coordinator Conformance 契约 | `conformanceContract` |
| `production-governance.ts` | Production Governance Port | — |
| `schedule.test.ts` / `production-governance.test.ts` 等 | 测试 | — |

## 文件(production-governance)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 入口 | `createGovernance` |
| `authorization.ts` | 鉴权 | `authorize` |
| `identity.ts` | 身份 | `loadIdentity` |
| `readiness.ts` | 就绪检查 | `evaluate` |
| `canonical-input.ts` | Canonical Input 校验 | `canonicalize` |
| `golden-vectors.ts` | Golden Case | `runVectors` |
| `failure-taxonomy.ts` | P8 失败分类→告警/runbook/响应路由单一映射;生成 Prometheus 规则 YAML;未知错误码兜底;重试预算护栏(fail closed) | `classifyUnattendedFailure`、`renderUnattendedAlertRulesYaml`、`assertUnattendedRetryBudget` |
| `pilot-gate.ts` | P8 运行门:五项证据(真实 soak、告警路由、认证、风险台账、评审签名),任一 UNFILLED 即 NO-GO 并列补齐路径 | `evaluatePilotGate` |
| `*.test.ts` | 测试 | — |

## 文件(secret-vault)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Secret Vault 入口 | `createVault`、`unseal` |
| `index.test.ts` | 测试 | — |

## 对外入口

- `@sage/agent-contracts` — TypeBox Schema;
- `@sage/app-contracts` — TypeBox Schema(schedules/resolutions wire);
- `@sage/platform-ports` — Port/类型(Schedule canonical);
- `@sage/production-governance` — `createGovernance`、`authorize`、`evaluate`、`evaluatePilotGate`、`classifyUnattendedFailure`;
- `@sage/secret-vault` — `unseal(name)`。

## 核心符号

- `agent-contracts` 类型聚合 — 跨包共享;
- `platform-ports/ReferenceEnvelope` — 大对象强制引用;
- `platform-ports/ScheduleControlStore` — Schedule 控制面 Port(Postgres/InMemory 双实现);
- `production-governance/evaluate` — 就绪/边界/遥测基数综合;
- `production-governance/authorize` — 鉴权判定;
- `production-governance/evaluatePilotGate` — 无人值守 pilot 运行门裁决(UNFILLED 阻断 GO);
- `production-governance/classifyUnattendedFailure` — 稳定错误码 → 告警规则/runbook/响应路由;
- `secret-vault/unseal` — 由 Master Key 解封。

## 依赖

- 模块 [state-persistence](../state-persistence/README.md) — Governance 状态与 Schedule 控制面落库;
- 模块 [release-and-admission](../release-and-admission/README.md) — Conformance 用 Governance;
- 模块 [apps](../apps/README.md) — agent-api、agent-worker 装配 Governance、pilot-gate 与 service token;
- 处理线 [unattended-failure-resolution](../../flows/unattended-failure-resolution.md) — 失败自治链路。
