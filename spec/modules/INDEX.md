# 模块(modules/)

| 模块 | 根 | 一句话 | 页 |
|------|-----|--------|-----|
| apps | `platform/apps/{agent-api,agent-worker,agent-web}` | 三个部署单元:HTTP/SSE API、Temporal Worker、Vite Web | [apps/README.md](apps/README.md) |
| agent-lib-runtime | `platform/packages/{agent-lib,harness-pi,model-broker,tool-runtime,context-resolver,provider-catalog,agent-client,platform-ports}` | Agent Run、Harness、Model/Tool/Context/Provider 适配 | [agent-lib-runtime/README.md](agent-lib-runtime/README.md) |
| chat-domain | `platform/packages/chat-domain` | Chat Session、流式消息、Tool/Artifact 流、Chat 持久化 | [chat-domain/README.md](chat-domain/README.md) |
| task-domain | `platform/packages/{task-domain,task-store-postgres,temporal-registry,temporal-routing,temporal-workflows}` | Temporal Task Router、Workflows、Worker Activity、跨环境路由 | [task-domain/README.md](task-domain/README.md) |
| state-persistence | `platform/packages/{agent-state-postgres,postgres-migrations}` | Agent State、Task Projection、Effect/Consumption Ledger、迁移 | [state-persistence/README.md](state-persistence/README.md) |
| contracts-and-policy | `platform/packages/{agent-contracts,app-contracts,production-governance,secret-vault}` | TypeBox 契约、Production Governance、Secret 解封 | [contracts-and-policy/README.md](contracts-and-policy/README.md) |
| release-and-admission | `platform/packages/{agent-package-release,agent-release-registry,agent-run-admission,agent-platform-conformance,agent-runtime-conformance}` | Package 打包与签名、Release Registry、Run Admission、Conformance | [release-and-admission/README.md](release-and-admission/README.md) |
| observability-and-local | `platform/packages/{observability,local-fakes,local-runtime}` | 指标/日志/追踪;Local Fakes、Local Runtime | [observability-and-local/README.md](observability-and-local/README.md) |
| examples-and-evidence | `platform/{examples,fixtures,scripts,evidence,spikes}`、`platform/compatibility.integration.test.ts`、`platform/Dockerfile`、`platform/Makefile` | P2–P7 集成、Fixtures、Spikes、自动化脚本、Exit Evidence | [examples-and-evidence/README.md](examples-and-evidence/README.md) |
| design-and-changes | `docs/design` `openspec/` `tasks/` `.agents` `.kimi-code` | 架构设计、OpenSpec 变更台账、任务归档 | [design-and-changes/README.md](design-and-changes/README.md) |

注:`platform/docs/`(部署、运维、phase exit review)按目录归入对应模块的「文件」表,不单独建页;其内容以文档而非代码为主,与 `evidence/` 协同。

## 跨模块交叉

- agent-lib-runtime 暴露的 LocalAgentClient 是 chat-domain 与 task-domain 的共同入口,详见 [concepts/agent-library.md](../concepts/agent-library.md);
- state-persistence 的 Port 由 platform-ports 定义,各 Store 实现,见 [contracts-and-policy](contracts-and-policy/README.md);
- release-and-admission 输出的 `release_id` 被 AgentRun 引用,见 [concepts/agent-package-release.md](../concepts/agent-package-release.md);
- examples-and-evidence 跑边界检查,见 [facets/verify.md](../facets/verify.md)。
