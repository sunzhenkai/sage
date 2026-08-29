# observability-and-local

观测(Local + Production 通用指标/日志/追踪)、Local Fakes(LocalAgentClient 的本地实现)、Local Runtime(本地启动的 Agent Kernel)。

## 根

| 路径前缀 | 角色 |
|----------|------|
| `platform/packages/observability` | 观测抽象 |
| `platform/packages/local-fakes` | Local Fakes(本地 Agent Client/Coordinator/Runtime) |
| `platform/packages/local-runtime` | 本地 Runtime Kernel |

## 文件(observability)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 观测入口 | `createObservability` |
| `index.test.ts` | 测试 | — |

## 文件(local-fakes)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Local Fakes 入口 | `createLocalFakes` |
| `runtime.ts` | 本地 Agent Runtime | `localRuntime` |
| `coordinator.ts` | 本地 Coordinator | `localCoordinator` |
| `schedule.ts` | 本地调度 | `localSchedule` |
| `production-governance.ts` | 本地 Governance | `localGovernance` |
| `*.test.ts` | 测试 | — |

## 文件(local-runtime)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 入口 | `startLocalRuntime` |
| `kernel.ts` | 本地 Kernel | `localKernel` |
| `kernel.test.ts` | 测试 | — |

## 对外入口

- `createObservability(opts)` — 注入 metrics/log/trace 收集;
- `createLocalFakes()` — 替换 LocalAgentClient / Coordinator / Schedule / Governance;
- `startLocalRuntime()` — 本地启动 Agent Kernel(测试与 spike 用)。

## 核心符号

- `observability/createObservability` — 构造观测;
- `local-fakes/runtime` / `coordinator` / `schedule` — 进程内可替换实现;
- `local-runtime/kernel` — 与 `agent-lib/kernel` 的本地版本。

## 依赖

- 模块 [agent-lib-runtime](../agent-lib-runtime/README.md) — LocalAgentClient 接口;
- 模块 [state-persistence](../state-persistence/README.md) — Postgres 适配(测试用);
- 模块 [task-domain](../task-domain/README.md) — Coordinator / Schedule。
