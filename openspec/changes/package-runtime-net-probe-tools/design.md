# Design: Package Run Tool Calling & Net Probe Capability

## 架构边界
- `packages/harness-pi` 保持零底层工具与存储依赖（遵守 `check-pi-boundaries.mjs`），仅通过构造函数注入的通用 `tools` 与 `executeTool` 回调驱动多轮 tool use。
- `packages/tool-runtime` 实现 `capability://net-probe-readonly/v1`，复用 `egress.ts` 的 `isBlockedEgressAddress` 与 `TrustedDnsResolverPort`，所有连接均通过 DNS pin + 连接后 `remoteAddress` 复检防止 DNS rebinding / SSRF。
- `apps/agent-api` 与 `packages/agent-run-admission` 在准入阶段将 `manifest.capabilityRefs` 写入 `runContract` 并按是否含运行时能力计算 `slice` 默认预算（`maxTurns` 上限 24、`maxToolCalls` 上限 64）。
- `apps/agent-worker` 在执行边界读取 `runContract.capabilityRefs` 并结合环境白名单 `SAGE_NET_PROBE_ALLOWLIST` 构造工具绑定；未声明能力的包拿不到任何工具。
