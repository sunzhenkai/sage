# apps

三个部署单元:`agent-api`(Fastify HTTP/SSE)、`agent-worker`(Temporal Activity Worker)、`agent-web`(Vite + Node 反代)。不写业务规则,只做装配、路由、健康检查、Bootstrap。

## 根

| 路径前缀 | 角色 |
|----------|------|
| `platform/apps/agent-api` | HTTP/SSE API 入口 |
| `platform/apps/agent-worker` | Temporal Worker 进程 |
| `platform/apps/agent-web` | Vite Web 与反代 |
| `platform/Dockerfile` | 三镜像构建入口 |
| `platform/compose.yaml` | 本地编排 |
| `platform/Makefile` | 本地快捷命令 |

## 文件(agent-api)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | 启动 Fastify、装配路由、健康检查 | `start` |
| `runtime.ts` | API 运行时构造(Postgres、Temporal、Vault) | `createRuntime` |
| `chat-compatibility.ts` | Chat 历史读写 | `getHistory` |
| `apps-api.ts` | Apps 列表/详情 | `list` / `get` |
| `catalog-api.ts` | Catalog 浏览 | `list` |
| `packages-api.ts` | AgentPackage 上传/读取 | `submit` / `get` |
| `pilot-admission.ts` | Pilot Admission(P7 入口) | `admit` |
| `production-identity.ts` | Production 身份注入 | `loadIdentity` |
| `production-readiness.ts` | Production 就绪检查 | `check` |
| `production-runtime.ts` | Production 运行时构造 | `createProductionRuntime` |
| `effect-resolution.ts` | Effect/Consumption 解析 | `resolveEffects` |
| `runs-api.ts` | Agent Run 触发/查询 | `start` / `get` |
| `run-output-resolver.ts` | Run 输出解析 | `resolve` |
| `run-agent-settings-api.ts` | Run 设置 | `get` / `put` |
| `tasks-api.ts` | Task 创建/查询 | `create` / `get` |
| `provider-connection.ts` | Provider 连接 | `connect` |
| `provider-connections-api.ts` | Provider 连接 API | `list` / `upsert` |
| `promotion.ts` | Release 升级 | `promote` |
| `task-api.p5.test.ts` 等 | 测试 | — |

## 文件(agent-worker)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Worker 启动、Worker 注册、Activity 订阅 | `start` |
| `runtime.ts` | Worker 运行时构造 | `createWorkerRuntime` |
| `activities.ts` | Temporal Activities(`runAgentActivity` 等) | `runAgentActivity` |
| `activities.coordinator.test.ts` 等 | 测试 | — |
| `reconcilers.ts` | TaskProjection 与 Agent State 的对账器 | `reconcile` |
| `production-runtime.ts` | Worker 的 Production 运行时 | `createProductionWorkerRuntime` |

## 文件(agent-web)

| 文件 | 职责 | 核心 |
|------|------|------|
| `main.tsx` | 入口、装配路由 | `App` |
| `chat.tsx` | Chat UI | `ChatView` |
| `tasks.tsx` | Task UI | `TasksView` |
| `packages.tsx` | Packages UI | `PackagesView` |
| `providers.tsx` | Providers UI | `ProvidersView` |
| `composer.tsx` | 输入器 | `Composer` |
| `markdown.tsx` | Markdown 渲染 | `Markdown` |
| `feedback.tsx` | Feedback 组件 | `Feedback` |
| `routing.ts` | 前端路由 | `routes` |
| `workspace.tsx` | Workspace 容器 | `Workspace` |
| `workspace-providers.tsx` | Workspace Provider 注入 | `WorkspaceProviders` |
| `*.test.tsx` 等 | 测试 | — |

## 对外入口

| 入口 | 协议 | 备注 |
|------|------|------|
| agent-api `:9610` | HTTP/SSE | 详见 [surface/INDEX.md](../../surface/INDEX.md) |
| agent-worker `:9611` | HTTP `/readyz` | 存活探活 |
| agent-web `:4173` | HTTP | Web UI |

## 核心符号

- agent-api `start` — 装配路由、监听端口、健康检查;
- agent-api `createRuntime` — 注入 Postgres / Temporal / Vault / Provider Catalog;
- agent-worker `start` — 启动 Temporal Worker、订阅 Task Queue、注册 Activity;
- agent-worker `runAgentActivity` — 把 Run 交给 Agent Library;
- agent-web `App` — 路由 + 主题 + Provider 注入。

## 依赖

- 模块 [agent-lib-runtime](../agent-lib-runtime/README.md) — LocalAgentClient;
- 模块 [chat-domain](../chat-domain/README.md) — Chat 历史与流;
- 模块 [task-domain](../task-domain/README.md) — Temporal 客户端与 Router;
- 模块 [state-persistence](../state-persistence/README.md) — Postgres / S3 适配;
- 模块 [contracts-and-policy](../contracts-and-policy/README.md) — Contracts、Vault、Governance。
