# release-and-admission

AgentPackage 打包、签名、Registry 登记、Run Admission、Conformance 一致性。Sage 的不可变供应链:`(package_id, version)` 是事实主键,Run 永远指向某个固定 Release。

## 根

| 路径前缀 | 角色 |
|----------|------|
| `platform/packages/agent-package-release` | Package 打包与签名 |
| `platform/packages/agent-release-registry` | Release Registry |
| `platform/packages/agent-run-admission` | Run 准入 |
| `platform/packages/agent-platform-conformance` | 终版架构 Conformance |
| `platform/packages/agent-runtime-conformance` | 运行时 Conformance |

## 文件(agent-package-release)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 入口 | `release` |
| `compiler.ts` | Package 编译 | `compile` |
| `source-loader.ts` | Source Loader | `loadSource` |
| `source-manifest.ts` | Source Manifest | `parseManifest` |
| `compiler.test.ts` 等 | 测试 | — |

## 文件(agent-release-registry)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Registry 入口 | `createRegistry` |
| `api.ts` | API | `submit` / `get` / `retire` |
| `production-admission.ts` | 生产准入 | `admit` |
| `*.test.ts` | 测试 | — |

## 文件(agent-run-admission)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 入口 | `admitRun` |
| `package-input.ts` | 包输入校验 | `validatePackageInput` |
| `release-run.ts` | 关联 Release 与 Run | `linkRun` |
| `production-admission.ts` | 生产准入 | `admit` |
| `production-readiness.ts` | 生产就绪 | `evaluate` |
| `rollout-policy.ts` | 灰度/放量策略 | `policy` |
| `release-run.test.ts` / `rollout-e2e.test.ts` 等 | 测试 | — |

## 文件(agent-platform-conformance)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 入口 | `runConformance` |
| `case-runner.ts` | Case Runner | `runCase` |
| `contracts.ts` | 契约集合 | `conformanceContracts` |
| `evidence.ts` | Evidence 生成 | `collectEvidence` |
| `gate.ts` | Gate | `evaluate` |
| `engine/`、`host/`、`determinism/`、`faults/` | 子模块 | — |
| `*.test.ts` | 测试 | — |

## 文件(agent-runtime-conformance)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 运行时一致性入口 | `runtimeConformance` |
| `index.test.ts` | 测试 | — |

## 对外入口

- `agent-package-release.release(input)` — 编译与签名;
- `agent-release-registry` 的 `submit` / `get` / `retire`;
- `agent-run-admission.admitRun`;
- `agent-platform-conformance.runConformance`。

## 核心符号

- `agent-package-release/compile` — 编译 Package,产出 hash;
- `agent-release-registry/submit` — 提交到 Registry,登记版本;
- `agent-release-registry/admit` — Production 准入校验;
- `agent-run-admission/admitRun` — Run 与 Release 关联准入;
- `agent-platform-conformance/gate.evaluate` — 终版架构 Gate 判定;
- `agent-runtime-conformance/runtimeConformance` — 运行时一致性。

## 依赖

- 模块 [contracts-and-policy](../contracts-and-policy/README.md) — TypeBox Schema、Production Governance、Vault;
- 模块 [state-persistence](../state-persistence/README.md) — Release 落库;
- 模块 [agent-lib-runtime](../agent-lib-runtime/README.md) — 校验 Agent 行为一致性;
- 模块 [examples-and-evidence](../examples-and-evidence/README.md) — Conformance Evidence 来源。
