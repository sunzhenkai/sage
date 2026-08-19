## Context

Sage 当前使用 TypeScript workspace、React/Vite、Fastify、Temporal SDK、PostgreSQL 和 Docker Compose。`platform/compose.yaml` 已能启动 `postgres`、`temporal`、`artifact-store`，但三个应用包只有库导出或构建脚本。P3-P6 integration harness 已证明 ChatStore、PostgresTaskStore、LocalAgentClient、PiHarness、Temporal Worker、Trusted routing/controller 和 Web contract 可以组合成完整纵向链路。

本设计面向本地开发/联调，不是生产部署设计。所有本地固定身份、凭据和端口必须与 `SAGE_DEPLOYMENT_MODE=local` 绑定；生产身份、Secret Manager、Artifact backend、HA 和发布审批保持排除。

## Goals / Non-Goals

**Goals:**

- 为 API、Worker、Web 提供可执行、可测试、可优雅退出的本地 runtime entrypoint。
- 复用现有领域构件，将 Chat、Task promotion、Temporal Worker 和 Web 代理组成最小单目标本地链路。
- 通过 Compose build/up/wait 和业务 smoke test 验证依赖健康与纵向行为。
- 保持已有基础设施端口、数据卷、Namespace `sage-dev` 和 Task Queue `sage-agent-task-v1` 兼容。

**Non-Goals:**

- 不提供生产镜像发布、负载均衡、HA、OIDC、Secret Manager 或 Artifact Store 真实 Adapter。
- 不把本地 Pi harness、固定 principal 或本地凭据当作生产实现。
- 不删除 named volume，不修改既有领域协议和 OpenSpec 业务语义。

## Decisions

### 1. API 使用单一 composition root 和单一 Fastify 实例

新增 `apps/agent-api/src/runtime.ts`，创建 `ChatStore`、`PostgresTaskStore`、`LocalAgentClient({ harness: new PiHarness() })`，执行迁移，并基于 `createDevRegistryBundle`、`publishDevRegistry`、`InMemoryCredentialProvider`、`TemporalClientFactory`、`TrustedTemporalRouter`、`TrustedMultiTargetTaskController` 装配 Task promotion。调用 `createChatApi` 后在同一实例注册 `registerTaskRoutes` 和 `/livez`、`/readyz`，最后监听 `SAGE_HTTP_HOST/SAGE_HTTP_PORT`。

选择单一 Fastify 实例而不是重新建服务器，是因为 `createChatApi` 已有连接关闭、短 Chat Run 取消和迁移语义；双实例会造成状态和 shutdown 不一致。固定本地 principal 仅在 `SAGE_DEPLOYMENT_MODE=local` 下启用。

### 2. Worker 复用 P4/P6 的 NativeConnection、bundle 和 Activity 装配

新增 `apps/agent-worker/src/runtime.ts`，创建 `PostgresTaskStore`、`ChatStore`、`LocalAgentClient({ harness: new PiHarness() })`，实现仅支持 `task-input://chat/<tenant>/<messageId>` 的 `TaskSliceInputResolver`，然后用 `bundleWorkflowCode`、`NativeConnection.connect`、`Worker.create` 和 `createAgentTaskActivities` 启动 Worker。

Worker 固定使用 `TASK_NAMESPACE` 与 `TASK_QUEUE`，不接受请求侧覆盖。健康服务器使用 Node `http`，livez 只反映进程未 shutdown；readyz 必须同时满足 Worker `getStatus()` 的 `RUNNING/POLLING/POLLING` 和 Store sentinel read。shutdown 顺序为 readiness 失败、`worker.shutdown()`、等待 `worker.run()`、关闭 health server 与 Store/NativeConnection。

### 3. Web 使用 Vite preview 作为本地容器服务器

`agent-web` 增加 `dev: vite`、`preview: vite preview`。`vite.config.ts` 的 `server.proxy` 和 `preview.proxy` 都使用 `SAGE_API_PROXY_TARGET`，宿主默认指向 `127.0.0.1:3000`，Compose 指向 `agent-api:3000`。Compose 构建后的 Web 使用 `vite preview --host 0.0.0.0 --port 4173 --strictPort`；它只用于本地/联调，不宣称生产静态服务器。

无 `session` 查询参数时，页面通过 `/v1/chat/sessions` 创建本地 session，再更新 URL；这样首次打开页面即有可用 Chat 上下文，而不是默认访问不存在的 `session-demo`。

### 4. 使用一个 workspace 多 stage Dockerfile

新增 `platform/Dockerfile`，build context 为 `platform/`，固定 Node `24.14.0` 和 pnpm `10.33.0`，使用 `pnpm install --frozen-lockfile` 和 workspace build。通过 `agent-api`、`agent-worker`、`agent-web` 三个 target 复用依赖层和源码层，最终运行镜像只复制对应 dist/运行所需 workspace dist 与 node_modules。

如果 pnpm workspace 的运行时符号链接使裁剪镜像复杂，则保持本地可重复的完整 workspace 运行层，不为 T0001 引入新的 packager 或静态服务器依赖。

### 5. Compose 依赖和健康检查按容器内协议定义

新增应用容器端口 API `3000`、Worker health `3001`、Web `4173`；宿主默认映射为 `13000`、`13001`、`14173`，通过 `SAGE_API_HOST_PORT`、`SAGE_WORKER_HEALTH_HOST_PORT`、`SAGE_WEB_HOST_PORT` 覆盖。API 依赖 PostgreSQL/Temporal healthy，Worker 依赖 PostgreSQL/Temporal healthy，Web 依赖 API ready。基础设施继续保留现有卷和端口。

API healthcheck 使用 `/livez` 和 `/readyz`，Worker healthcheck 使用 `/readyz`，Web healthcheck 请求 `/`。健康检查命令使用 Node 24 内置 `fetch`，不新增 curl 依赖到应用镜像。

### 6. Smoke test 验证业务链路而非只查端口

新增 `scripts/smoke-local-stack.mjs`：先运行 `docker compose config --quiet`、`up -d --build --wait`，检查六项服务状态与三个应用端点；创建 Chat session 和 message，轮询 Chat Run；通过 promotion 创建 Task，轮询 Task succeeded；请求 Web 首页并从 Web origin 请求 API proxy。脚本使用 finally 执行 `docker compose down --remove-orphans`，保留 volumes；失败打印有限的 Compose 状态和应用日志，不打印凭据。

## Risks / Trade-offs

- [Risk] 本地 API 固定 principal 可能被误用于非本地环境 → 启动时强制 `SAGE_DEPLOYMENT_MODE=local`，非 local 直接失败，并在文档中标明。
- [Risk] Worker readiness 只依赖 poller 状态但尚未执行业务 → 额外执行 PostgreSQL/Chat sentinel read，smoke 再验证真实 Task 完成。
- [Risk] `PiHarness` 是确定性本地实现，不代表真实 provider → 文档明确本地替身边界，生产能力不在本任务范围。
- [Risk] 三个应用的 workspace 运行依赖使镜像偏大 → 优先复用完整 workspace 构建层，保持可重复性，不为尺寸引入未验证工具。
- [Risk] Web preview 不是生产静态服务器 → 仅加入本地 Compose，部署文档继续保留生产 NO-GO。
- [Risk] API 与 Worker 都初始化 migration → Store migration SQL 应保持幂等；健康检查不执行写迁移，启动阶段失败即退出而不是误报 ready。
- [Risk] 当前工作区已有未提交文件 → 不执行 stash、reset 或覆盖既有变更；实现分支需通过 task workflow 的 dirty gate 后再准备。

## Migration Plan

1. 在实现前完成 OpenSpec 契约和目标分支准备。
2. 先加入 runtime 配置/健康 predicate 单测，再加入 API/Worker/Web 入口。
3. 构建多 stage 镜像并扩展 Compose，先运行配置校验和 targeted runtime tests。
4. 运行整栈 smoke、typecheck、build 及相关 P3/P4/P6 integration。
5. 回滚时移除新增应用服务或回到上一 Git revision；使用 `docker compose down --remove-orphans` 保留 volumes，不执行 `--volumes`。

## Open Questions

- 本地 API 是否需要在 T0001 同时暴露完整 P6 artifact resolver；当前最小链路只验证 Chat/Task/Worker，Artifact backend 保持未接入。
- 若当前 Temporal SDK 的 Worker status 在容器启动窗口不稳定，readyz 是否需要有限重试；默认由 Compose healthcheck retry 处理，不改变语义。
