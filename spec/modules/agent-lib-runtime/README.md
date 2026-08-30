# agent-lib-runtime

Sage 的执行内核:Agent Library、PiHarness、Model Broker、Tool Runtime、Context Resolver、Provider Catalog、Agent Client、Platform Ports。本模块是 Chat 与 Temporal Activity 共用的 Agent Loop 入口,Loop 不在调用侧复制。

## 根

| 路径前缀 | 角色 |
|----------|------|
| `platform/packages/agent-lib` | Agent Run 内核(`kernel.ts`、Loop、Run State) |
| `platform/packages/harness-pi` | PiHarness 绑定(LLM/Tool 调度) |
| `platform/packages/model-broker` | Model 调用与适配 |
| `platform/packages/tool-runtime` | Tool/MCP 适配与 Sandbox |
| `platform/packages/context-resolver` | Context 装配 |
| `platform/packages/provider-catalog` | Provider 目录(本地/部署环境) |
| `platform/packages/agent-client` | 对外 LocalAgentClient API |
| `platform/packages/platform-ports` | Store/Port 接口与 ReferenceEnvelope |

## 文件(agent-lib)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 公共导出 | — |
| `kernel.ts` | Agent Loop 主循环 | `runLoop`、`step` |
| `kernel.test.ts` / `index.test.ts` | 单元测试 | — |

## 文件(harness-pi)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | PiHarness 适配入口 | `createHarness` |

## 文件(model-broker)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 公共导出 | `createBroker` |

## 文件(tool-runtime)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Tool/MCP 注册入口;P8 re-export 受控快照出口 | `registerTool` |
| `sandbox.ts` | 工具执行沙箱 | `runSandboxed` |
| `egress.ts` | 出站白名单 | `checkEgress` |
| `snapshot-egress.ts` | P8 包运行输入快照受控出口:`SAGE_PACKAGE_SNAPSHOT_EGRESS_ALLOWLIST`(default-deny)解析为 connector,供 admission/dataSource 抓取共用 | `parseSnapshotEgressAllowlist`、`buildSnapshotEgressConnector` |
| `effect-ledger.integration.test.ts` 等 | 测试 | — |

## 文件(context-resolver)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Context 装配入口 | `resolveContext` |

## 文件(provider-catalog)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 公共导出 | — |
| `source.ts` | Provider 来源(本地/env/Sage-managed) | `loadSources` |
| `service.ts` | Provider Service | `callService` |
| `manager.ts` | Provider Manager | `selectProvider` |
| `store.ts` | Provider 状态存储 | — |
| `projection.ts` | Provider Projection | `project` |
| `migrations.ts` | Provider schema 迁移 | `migrate` |
| `activation.ts` | Provider 激活 | `activate` |
| `auth.ts` | Provider 鉴权 | `auth` |
| `source.live.test.ts` 等 | 测试 | — |

## 文件(agent-client)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | LocalAgentClient API | `createClient` |
| `canonical.ts` | Canonical Agent Client | `canonicalRun` |
| `execution-policy.ts` | 执行策略 | `policy` |
| `compatibility.ts` | 兼容性垫片 | `compat` |
| `index.test.ts` 等 | 测试 | — |

## 文件(platform-ports)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Port 接口聚合;P8 新增 `ScheduleControlStore` Port 与 `assertScheduleSnapshot` | `assertScheduleSnapshot` |
| `runtime.ts` | RuntimeCorrelation | `runtimeCorrelation` |
| `schedule.ts` | 调度抽象(canonical Schedule 契约,不泄漏 Temporal 类型) | `ScheduleControlStore` |
| `coordinator-conformance.ts` | 协调器一致性 | `conform` |
| `production-governance.ts` | Production Governance Port | `govern` |

## 对外入口

- `agent-client` 的 `LocalAgentClient`:`runAgent(taskSpec)`、`streamRunEvents`、`resumeRun`;
- `tool-runtime` 的 `registerTool`;
- `provider-catalog` 的 `selectProvider` / `loadSources`;
- `platform-ports` 的所有 Port(被各 Store 包实现)。

## 核心符号

- `agent-lib/kernel.runLoop` — Agent 主循环,PiHarness 调度,Effect 落账;
- `agent-client/createClient` — LocalAgentClient 工厂;
- `tool-runtime/runSandboxed` — 沙箱内执行工具,受 egress 限制;
- `model-broker/createBroker` — 多 Provider 路由;
- `provider-catalog/selectProvider` — 按租户/部署模式挑选;
- `platform-ports/runtimeCorrelation` — 跨进程关联 ID。

## 依赖

- 模块 [state-persistence](../state-persistence/README.md) — Port 实现;
- 模块 [contracts-and-policy](../contracts-and-policy/README.md) — 契约与 Secret;
- 模块 [release-and-admission](../release-and-admission/README.md) — Release/Conformance。
