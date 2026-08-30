# release-and-admission

AgentPackage 打包、签名、Registry 登记、Run Admission、Conformance 一致性。Sage 的不可变供应链:`(package_id, version)` 是事实主键,Run 永远指向某个固定 Release。P8 起 App 以 manifest v2 自闭环声明(inputs/dataSources/tasks/output),Schedule 触发与人工触发走同一条包运行准入。

## 根

| 路径前缀 | 角色 |
|----------|------|
| `platform/packages/agent-package-release` | Package 打包与签名(manifest v2) |
| `platform/packages/agent-release-registry` | Release Registry |
| `platform/packages/agent-run-admission` | Run 准入(含 schedule 触发准入) |
| `platform/packages/agent-platform-conformance` | 终版架构 Conformance |
| `platform/packages/agent-runtime-conformance` | 运行时 Conformance |

## 文件(agent-package-release)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 入口 | `release` |
| `compiler.ts` | Package 编译,digest 覆盖 manifest v2 全部声明(inputs/dataSources/tasks/modelRoute/output) | `compile` |
| `source-loader.ts` | Source Loader;装载 v2 资产(prompts/references/output schema) | `loadSource` |
| `source-manifest.ts` | Source Manifest;v2 解析与校验(`schemaVersion: '2'`,未知字段拒绝,inputs/dataSources ≤8 条,dataSource 必须 public HTTPS 无凭据) | `parseManifest` |
| `src/source-manifest.v2.test.ts`、`src/*smoke.test.ts` 等 | 测试(含 `finance-briefing.smoke.test.ts`、`github-trending.smoke.test.ts`、`lifecycle-probe.smoke.test.ts` 内嵌源包冒烟) | — |
| `fixtures/source-packages/{v2-valid,v2-task-missing-entry,…}` | manifest v2 编译 fixture | — |

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
| `package-input.ts` | 包输入校验;P8 按 manifest inputs 校验声明参数(未声明/类型不符/缺必填拒绝),dataSources 受控获取与 `onFailure` 语义 | `validatePackageInput` |
| `schedule-trigger.ts` | P8 触发准入 `admitScheduleTrigger`:FOLLOW 解析锚点 Release 当前 active / FIXED 固化 digest,三层幂等(workflow ID、admission 幂等键、task store 唯一约束),快照受控抓取 | `admitScheduleTrigger` |
| `release-run.ts` | 关联 Release 与 Run | `linkRun` |
| `production-admission.ts` | 生产准入 | `admit` |
| `production-readiness.ts` | 生产就绪 | `evaluate` |
| `rollout-policy.ts` | 灰度/放量策略 | `policy` |
| `release-run.test.ts`、`package-input.v2.test.ts` 等 | 测试 | — |

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
- `agent-run-admission.admitRun`、`admitScheduleTrigger`;
- `agent-platform-conformance.runConformance`。

## 核心符号

- `agent-package-release/compile` — 编译 Package,产出 hash(v2 全声明入 digest);
- `agent-release-registry/submit` — 提交到 Registry,登记版本;
- `agent-release-registry/admit` — Production 准入校验;
- `agent-run-admission/admitRun` — Run 与 Release 关联准入;
- `agent-run-admission/admitScheduleTrigger` — schedule occurrence → AgentTaskSpec 新 attempt(FIXED 不漂移、FOLLOW 不兼容即稳定失败告警);
- `agent-platform-conformance/gate.evaluate` — 终版架构 Gate 判定;
- `agent-runtime-conformance/runtimeConformance` — 运行时一致性。

## 依赖

- 模块 [contracts-and-policy](../contracts-and-policy/README.md) — TypeBox Schema、Production Governance、Vault;
- 模块 [state-persistence](../state-persistence/README.md) — Release 落库;
- 模块 [agent-lib-runtime](../agent-lib-runtime/README.md) — 校验 Agent 行为一致性;受控出口(`snapshot-egress`);
- 模块 [examples-and-evidence](../examples-and-evidence/README.md) — Conformance Evidence 来源;
- 概念 [App Manifest v2](../concepts/app-manifest-v2.md)、[Schedule Plane](../concepts/schedule-plane.md);
- 处理线 [release-admission](../../flows/release-admission.md)、[schedule-triggered-run](../../flows/schedule-triggered-run.md)。
