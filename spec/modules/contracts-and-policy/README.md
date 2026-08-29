# contracts-and-policy

跨包共享契约、Production Governance、Secret Vault。`agent-contracts` 与 `app-contracts` 用 TypeBox 写 Schema;`platform-ports` 用 TypeScript interface 写 Port;`production-governance` 写边界/遥测/计费的硬约束;`secret-vault` 解封密钥。

## 根

| 路径前缀 | 角色 |
|----------|------|
| `platform/packages/agent-contracts` | Agent 共享 Schema(TypeBox) |
| `platform/packages/app-contracts` | 应用层共享 Schema |
| `platform/packages/platform-ports` | Port 接口与 ReferenceEnvelope |
| `platform/packages/production-governance` | Production 边界检查 |
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
| `index.ts` | 应用层 Schema | — |
| `index.test.ts` | 测试 | — |

## 文件(platform-ports)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Port 接口、ReferenceEnvelope、RuntimeCorrelation | — |
| `runtime.ts` | RuntimeCorrelation 工具 | — |
| `schedule.ts` | 调度抽象 | — |
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
| `*.test.ts` | 测试 | — |

## 文件(secret-vault)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Secret Vault 入口 | `createVault`、`unseal` |
| `index.test.ts` | 测试 | — |

## 对外入口

- `@sage/agent-contracts` — TypeBox Schema;
- `@sage/app-contracts` — TypeBox Schema;
- `@sage/platform-ports` — Port/类型;
- `@sage/production-governance` — `createGovernance`、`authorize`、`evaluate`;
- `@sage/secret-vault` — `unseal(name)`。

## 核心符号

- `agent-contracts` 类型聚合 — 跨包共享;
- `platform-ports/ReferenceEnvelope` — 大对象强制引用;
- `production-governance/evaluate` — 就绪/边界/遥测基数综合;
- `production-governance/authorize` — 鉴权判定;
- `secret-vault/unseal` — 由 Master Key 解封。

## 依赖

- 模块 [state-persistence](../state-persistence/README.md) — Governance 状态落库;
- 模块 [release-and-admission](../release-and-admission/README.md) — Conformance 用 Governance;
- 模块 [apps](../apps/README.md) — agent-api、agent-worker 装配 Governance。
