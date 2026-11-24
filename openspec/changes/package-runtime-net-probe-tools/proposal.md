# Proposal: Package Run 多轮 Tool Calling 与只读网络探测能力

## 背景
当前 Sage 的 Package Run（AI App 包运行）在 `LiveProviderHarness` 与 `agent-worker` 执行边界仅支持单轮纯文本推理，`app.yaml` 中声明的 `capabilityRefs` 仅作元数据保留，未在运行时向模型注入受控工具。同时 `schedule-runtime` 启动工作流时未传递 `slice` 预算。

## 目标
1. 为 `LiveProviderHarness` 与 `createLivePackageAgentClient` 补齐基于 `@mariozechner/pi-ai` 的多轮 tool calling 循环，严格受 `AgentRunner` 的 `maxTurns`、`maxToolCalls`、`maxTokens` 与 `deadlineAt` 预算约束。
2. 在 `@sage/tool-runtime` 新增通用只读能力 `capability://net-probe-readonly/v1`（`http_probe` / `tls_probe` / `tcp_probe`），采用 `SAGE_NET_PROBE_ALLOWLIST` default-deny 白名单、DNS pin 与私有地址拦截防 SSRF，并对响应正文摘要做敏感凭据脱敏。
3. 将 `manifest.capabilityRefs` 固化进 `TaskPackageInputRecord.runContract`（覆盖手动触发与 Schedule 触发），由 `agent-worker` 在执行边界按声明按需注入工具子集（权限单调收窄），并同步放宽 `TaskSliceLimitsSchema` 的轮次/工具调用上限。

## 非目标
- 不向模型暴露任意 shell、任意 HTTP 或未受控的网络扫描能力。
- 不在本变更中引入 SSH 主机内检查或独立采集服务（留待后续阶段）。
