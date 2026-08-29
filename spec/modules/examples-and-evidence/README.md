# examples-and-evidence

集成测试、Fixtures、Spikes、自动化脚本、Exit Evidence。所有非核心业务路径的工程产物都在这一层,为生产治理与终版架构合规提供证据。

## 根

| 路径前缀 | 角色 |
|----------|------|
| `platform/examples/{p3,p4,p5,p6}-integration` | Phase 集成测试(Postgres + Temporal) |
| `platform/examples/{ai-apps,evidence-digest,node-host}` | 场景化端到端 |
| `platform/examples/production-governance-integration` | 生产治理 fault/load 矩阵 |
| `platform/fixtures/{p7,phase3,production-governance,reference-workload}` | 制品/数据 fixture |
| `platform/scripts/` | 边界/依赖/scan/preflight 脚本 |
| `platform/scripts/agent-platform-final/` | 终版架构证据生成 |
| `platform/evidence/{agent-platform-final,…}` | Exit Review 与 Acceptance Evidence |
| `platform/spikes/` | 技术 Spike(pi、temporal 等) |
| `platform/compatibility.integration.test.ts` | 跨包集成冒烟 |
| `platform/Dockerfile`、`platform/compose.yaml`、`platform/Makefile`、`platform/eslint.config.js` | 构建与编排 |
| `platform/docs/*.md`(部署/运维/phase exit review) | 工程文档 |

## 文件(关键子集)

| 文件 / 目录 | 职责 | 核心 |
|------|------|------|
| `examples/p3-integration/src` | P3 集成(Postgres + Chat) | p3 suite |
| `examples/p4-integration/src` | P4 集成(短 Chat → Temporal) | p4 suite |
| `examples/p5-integration/src` | P5 集成(多环境 Router) | p5 suite |
| `examples/p6-integration/src` | P6 集成(可恢复/可重放/可审计) | p6 suite |
| `examples/production-governance-integration/src` | Fault/Load 矩阵 | fault / load |
| `examples/evidence-digest/src` | Evidence 摘要生成 | — |
| `examples/node-host/src` | Node Host(终版架构 Host) | — |
| `examples/ai-apps/src` | AI Apps 端到端 | — |
| `fixtures/p7`、`fixtures/phase3`、`fixtures/production-governance`、`fixtures/reference-workload` | 数据 fixture | — |
| `scripts/check-dependencies.mjs` | 依赖方向 | `checkDeps` |
| `scripts/check-*-boundaries.mjs` | 各 Phase 边界 | `checkBoundaries` |
| `scripts/production-governance/*` | 生产治理脚本 | `preflight` |
| `scripts/agent-platform-final/*` | 终版架构证据 | `buildEvidence` / `validateSystemModel` |
| `scripts/smoke-local-stack.mjs` | 本地全栈冒烟 | `smoke` |
| `evidence/agent-platform-final/` | 终版架构 evidence | — |
| `evidence/agent-package-release-admission/` | Release 准入 evidence | — |
| `evidence/agent-runtime-kernel-broker-integration/` | Runtime Kernel evidence | — |
| `spikes/pi-capabilities.test.ts` | PiHarness spike | — |
| `spikes/temporal*` | Temporal 能力 spike | — |
| `compatibility.integration.test.ts` | 跨包冒烟 | — |
| `Dockerfile` | 三镜像构建 | — |
| `compose.yaml` | 本地编排 | — |
| `Makefile` | 快捷命令 | — |
| `eslint.config.js` | Lint 配置 | — |
| `docs/local-development.md` 等 | 部署/运维/phase exit review 文档 | — |

## 对外入口

- 顶层 `pnpm` 脚本(见 `platform/package.json` 的 `scripts`);
- `scripts/agent-platform-final/*` 与 `pnpm check:agent-platform-final` 是终版架构证据主路径;
- `examples/*` 由 `pnpm test:p{3,4,5,6}:integration` 触发。

## 核心符号

- `scripts/check-dependencies.checkDeps` — 跨包依赖方向;
- `scripts/agent-platform-final/build-traceability` — 证据生成;
- `scripts/agent-platform-final/validate-system-model` — System Model 校验;
- `scripts/agent-platform-final/validate-architecture-review` — 架构评审校验;
- `examples/p4-integration` — 短 Chat → Temporal 提升的可运行样例;
- `examples/p6-integration` — 可恢复/可重放/可审计的可运行样例。

## 依赖

- 全部业务模块([apps](../apps/README.md) 等);
- `openspec/` 通过 `openspec validate` 在 `check:agent-platform-final` 中校验;
- `docs/design/` 与 `openspec/changes/` 是 evidence 的来源之一。
