# apps

三个部署单元:`agent-api`(Fastify HTTP/SSE)、`agent-worker`(Temporal Activity Worker + Schedule Dispatcher Worker)、`agent-web`(Vite + Node 反代)。不写业务规则,只做装配、路由、健康检查、Bootstrap。

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
| `runtime.ts` | API 运行时构造(Postgres、Temporal、Vault);P8 装配 SchedulePort(`TemporalScheduleAdapter`/本地 fakes)、schedules/resolutions 路由、`ServiceTokenAuthenticator` | `createRuntime` |
| `chat-compatibility.ts` | Chat 历史读写 | `getHistory` |
| `apps-api.ts` | Apps 列表/详情;pilot 强认证接线 | `list` / `get` |
| `catalog-api.ts` | Catalog 浏览 | `list` |
| `packages-api.ts` | AgentPackage 上传/读取;manifest v2(inputs/dataSources/tasks)落库与强认证 | `submit` / `get` |
| `pilot-admission.ts` | Pilot Admission(P7 入口) | `admit` |
| `production-identity.ts` | Production 身份注入 | `loadIdentity` |
| `production-readiness.ts` | Production 就绪检查 | `check` |
| `production-runtime.ts` | Production 运行时构造 | `createProductionRuntime` |
| `effect-resolution.ts` | Effect/Consumption 解析 | `resolveEffects` |
| `effect-resolutions-api.ts` | P8 `POST /v1/effects/resolutions` 统一裁决(retry 新 attempt / Ledger replay / terminate) | `registerEffectResolutionsRoute` |
| `schedules-api.ts` | P8 `/v1/schedules` 创建/列表/详情/触发历史/pause-resume/delete,全操作审计,service token 强认证 | `registerSchedulesRoutes` |
| `service-token.ts` | service token 认证(`SAGE_SERVICE_TOKEN_HASHES`,哈希 + 常量时间比较 + 可轮换) | `ServiceTokenAuthenticator` |
| `package-snapshots.ts` | 包运行输入快照受控抓取(白名单 connector,default-deny) | `fetchPackageSnapshots` |
| `runs-api.ts` | 包运行触发/查询;P8 声明式输入(`task` + `params`),自由 `input` 出现即 410 `INPUT_REMOVED` | `start` / `get` |
| `run-output-resolver.ts` | Run 输出解析;支持 `#file/{name}` 声明产物名引用 | `resolve` |
| `run-agent-settings-api.ts` | Run 设置 | `get` / `put` |
| `tasks-api.ts` | Task 创建/查询 | `create` / `get` |
| `provider-connection.ts` | Provider 连接 | `connect` |
| `provider-connections-api.ts` | Provider 连接 API | `list` / `upsert` |
| `promotion.ts` | Release 升级 | `promote` |
| `scripts/register-package.ts` | 注册脚本;P8 起优先 `SAGE_SERVICE_TOKEN`(Bearer),否则回退 stub 头 | — |
| `task-api.p5.test.ts`、`schedules-api.test.ts`、`effect-resolutions-api.test.ts` 等 | 测试 | — |

## 文件(agent-worker)

| 文件 | 职责 | 核心 |
|------|------|------|
| `index.ts` | Worker 启动、Worker 注册、Activity 订阅 | `start` |
| `runtime.ts` | Worker 运行时构造 | `createWorkerRuntime` |
| `activities.ts` | Temporal Activities(`runAgentActivity` 等);P8 在执行边界按 manifest `modelRoute` 解析连接、按 `run_contract` 强制输出契约 | `runAgentActivity` |
| `schedule-runtime.ts` | P8 Schedule Dispatcher Worker(`sage-schedule-dispatcher-v1` task queue,`SAGE_SCHEDULE_DISPATCH_ENABLED` 开关) | `createScheduleDispatcher` |
| `schedule-activities.ts` | dispatcher activities:调 `admitScheduleTrigger` 完成触发准入(Release 解析、快照抓取、预算) | `createScheduleDispatcherActivities` |
| `output-contract.ts` | 输出契约强制:剥离 think 段、解 JSON 围栏、按 schema 子集校验、产物名登记;违反即 `PACKAGE_OUTPUT_CONTRACT_VIOLATION` | `enforceOutputContract` |
| `schedules-e2e.test.ts`、`output-contract.test.ts`、`activities.coordinator.test.ts` 等 | 测试 | — |
| `reconcilers.ts` | TaskProjection 与 Agent State 的对账器 | `reconcile` |
| `production-runtime.ts` | Worker 的 Production 运行时 | `createProductionWorkerRuntime` |

## 文件(agent-web)

| 文件 | 职责 | 核心 |
|------|------|------|
| `main.tsx` | 入口、装配路由 | `App` |
| `chat.tsx` | Chat UI | `ChatView` |
| `tasks.tsx` | Task UI | `TasksView` |
| `packages.tsx` | Packages UI;应用页一键导入内嵌示例项目 | `PackagesView` |
| `schedules.tsx` | P8 定时任务视图:列表/触发历史/暂停恢复删除 | `SchedulesApp` |
| `example-apps.ts` | 内嵌示例源包(finance-briefing 等)与一键导入数据 | `EXAMPLE_APPS` |
| `providers.tsx` | Providers UI | `ProvidersView` |
| `composer.tsx` | 输入器 | `Composer` |
| `markdown.tsx` | Markdown 渲染 | `Markdown` |
| `feedback.tsx` | 横幅/行内提示/加载态/空态共享组件 | `Feedback` |
| `fields.tsx` | 表单字段共享控件 | — |
| `routing.ts` | 前端路由 | `routes` |
| `workspace.tsx` | Workspace 容器 | `Workspace` |
| `workspace-providers.tsx` | Workspace Provider 注入 | `WorkspaceProviders` |
| `schedules.test.tsx`、`example-apps.test.ts`、`packages.test.tsx` 等 | 测试 | — |

## 对外入口

| 入口 | 协议 | 备注 |
|------|------|------|
| agent-api `:9610` | HTTP/SSE | 详见 [surface/INDEX.md](../../surface/INDEX.md) |
| agent-worker `:9611` | HTTP `/readyz` | 存活探活;dispatcher worker 同进程健康面 |
| agent-web `:4173` | HTTP | Web UI |

## 核心符号

- agent-api `start` — 装配路由、监听端口、健康检查;
- agent-api `createRuntime` — 注入 Postgres / Temporal / Vault / Provider Catalog / SchedulePort;
- agent-api `registerSchedulesRoutes` — Schedule 控制面路由(审计 + service token);
- agent-worker `start` — 启动 Temporal Worker、订阅 Task Queue、注册 Activity;
- agent-worker `runAgentActivity` — 把 Run 交给 Agent Library(输出契约在物化点强制);
- agent-worker `createScheduleDispatcher` — 启动 Schedule Dispatcher Worker(触发→准入);
- agent-web `App` — 路由 + 主题 + Provider 注入。

## 依赖

- 模块 [agent-lib-runtime](../agent-lib-runtime/README.md) — LocalAgentClient;
- 模块 [chat-domain](../chat-domain/README.md) — Chat 历史与流;
- 模块 [task-domain](../task-domain/README.md) — Temporal 客户端与 Router、`temporal-schedules` adapter、触发准入;
- 模块 [state-persistence](../state-persistence/README.md) — Postgres / S3 适配、Schedule 控制面存储;
- 模块 [contracts-and-policy](../contracts-and-policy/README.md) — Contracts、Vault、Governance、pilot-gate;
- 处理线 [schedule-triggered-run](../../flows/schedule-triggered-run.md) — 定时触发端到端。
