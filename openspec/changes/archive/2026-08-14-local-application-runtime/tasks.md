## 1. Runtime 配置与健康契约

- [x] 1.1 新增共享本地 runtime 配置解析，校验 `SAGE_DEPLOYMENT_MODE=local`、PostgreSQL/Temporal 地址、固定 Namespace/Task Queue、tenant 和端口默认值。
- [x] 1.2 新增 API/Worker health handler 与 readiness predicate 单测，覆盖 API local-only 配置和 Worker 非 `RUNNING/POLLING` 状态。

## 2. API composition root

- [x] 2.1 实现 `apps/agent-api/src/runtime.ts`，装配 ChatStore、PostgresTaskStore、PiHarness/LocalAgentClient、trusted local routing/controller、认证/授权和既有 routes。
- [x] 2.2 在 API 单一 Fastify 实例增加 `/livez`、`/readyz`、可配置监听和 SIGTERM/SIGINT 优雅退出。
- [x] 2.3 为 API runtime 增加启动配置、health 和本地 smoke 所需的 workspace scripts/tsconfig references。

## 3. Worker composition root

- [x] 3.1 实现受限的 `task-input://chat/<tenant>/<messageId>` resolver，并覆盖未知 scheme、跨租户和消息不存在测试。
- [x] 3.2 实现 `apps/agent-worker/src/runtime.ts`，装配 PostgresTaskStore、ChatStore、Activities、workflow bundle、NativeConnection 和 Temporal Worker。
- [x] 3.3 增加 Worker health HTTP server、poller readiness、配置和优雅退出脚本/测试。

## 4. Web runtime

- [x] 4.1 增加 `agent-web` 的 `dev`/`preview` scripts，并参数化 Vite server/preview `/v1` proxy target。
- [x] 4.2 调整无 session 首次访问行为，创建本地 Chat session 后渲染页面；通过 host smoke 验证页面可加载和 `/v1` proxy。

## 5. 容器与 Compose 编排

- [x] 5.1 新增固定 Node/pnpm 的 workspace 多 stage Dockerfile，提供 API、Worker、Web 三个构建目标并验证 build；隔离 Compose smoke 已完成三镜像构建并成功启动。
- [x] 5.2 扩展 `platform/compose.yaml`，加入三应用服务、服务名寻址、健康依赖、端口覆盖和本地环境变量。
- [x] 5.3 为 API、Worker、Web 配置协议级 healthcheck，并验证六项服务 `docker compose up -d --build --wait` 达到 healthy；隔离 Compose smoke 已确认 PostgreSQL、Temporal、Artifact store、API、Worker、Web 全部 healthy。

## 6. 整栈 smoke 与开发入口

- [x] 6.1 新增 `scripts/smoke-local-stack.mjs`，验证六服务健康、Chat session/message、promotion、Temporal Worker Task succeeded 和 Web proxy；隔离完整 smoke 已通过。
- [x] 6.2 增加根 workspace `smoke:local`、Makefile 目标或等价入口，失败时打印有限诊断并 finally 保留 volumes 清理。

## 7. 文档与回归验证

- [x] 7.1 更新 `docs/local-development.md`、`docs/deployment.md` 和 `.service-manager.md`，记录端口、环境变量、启动/停止/日志/健康检查、本地身份与生产 NO-GO 边界。
- [x] 7.2 运行 runtime targeted tests、`corepack pnpm typecheck`、`corepack pnpm build`、Compose config 和 smoke；runtime targeted tests、完整 `corepack pnpm check`、Compose config、OpenSpec strict validation 与完整隔离 Compose smoke 均已通过。
- [x] 7.3 更新 T0001 README 验收复选框、变更记录和 OpenSpec 关联，记录实现范围与未改变的生产边界。
