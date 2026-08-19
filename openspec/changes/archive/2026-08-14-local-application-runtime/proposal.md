## Why

当前 Sage 的 Compose 只能启动 PostgreSQL、Temporal 和 Artifact Store，`agent-api`、`agent-worker`、`agent-web` 没有可独立执行的 runtime entrypoint、容器单元或健康检查。开发者只能依赖阶段性集成 harness，无法用一条可重复命令启动并验证完整的本地 Chat→Task→Worker→Web 链路；现在补齐本地运行闭环可以让既有 P3-P6 构件直接服务于开发和联调，同时保持生产 `NO-GO` 边界不变。

## What Changes

- 为 `agent-api` 增加本地 composition root：装配 PostgreSQL Chat/Task Store、`LocalAgentClient`/`PiHarness`、可信本地 Temporal routing/controller、Task routes、受限本地身份和 liveness/readiness 端点。
- 为 `agent-worker` 增加 Temporal Worker composition root：连接 `sage-dev`、`sage-agent-task-v1`，装配 Activities、PostgreSQL Store、受批准的 Chat input resolver 和健康 HTTP 端点。
- 为 `agent-web` 增加 `dev`/`preview` 启动脚本、可配置 API proxy 和稳定的初始 Chat session 行为。
- 增加可复用 workspace Dockerfile/构建目标，为三个应用提供本地容器单元。
- 扩展 `platform/compose.yaml`：编排六个服务的依赖、端口、环境变量、健康检查和正常退出。
- 增加整栈 smoke test，验证 API/Worker/Web 健康、Chat session/message、Chat promotion、Temporal Worker 完成 Task 以及 Web proxy。
- 更新 Makefile、workspace scripts、本地开发/部署文档和服务管理记录。
- 不引入生产身份、生产 Secret、Artifact 持久化 Adapter 或生产部署能力；不删除现有 named volumes。

## Capabilities

### New Capabilities

- `local-application-runtime`: 为 API、Worker、Web 提供本地进程入口、依赖装配、配置和优雅退出。
- `local-application-orchestration`: 以 Docker Compose 编排完整本地应用栈，并提供依赖感知的健康检查和端口覆盖。
- `local-stack-smoke-verification`: 通过可重复 smoke test 验证健康状态及 Chat→Task→Worker→Web 纵向链路。

### Modified Capabilities

- `local-development-profile`: 将本地 profile 从三项基础设施扩展为包含 API、Worker、Web 的完整开发栈，并保持基础设施端口和数据卷兼容。
- `chat-user-interface`: Web 本地运行时通过 API proxy 加载服务并在无 session 参数时创建可用的 Chat session；既有 UI contract 不变。
- `task-operations-interface`: 本地 API/Worker 运行时暴露已有 Task operations contract，使用固定本地身份和可信 routing；不改变生产授权语义。

## Impact

- 代码：`platform/apps/agent-api`、`platform/apps/agent-worker`、`platform/apps/agent-web` 及必要的 workspace packages。
- 编排：`platform/compose.yaml`、Dockerfile、`platform/Makefile`、根 workspace scripts。
- 验证：新增 runtime/health 单测和 `platform/scripts/smoke-local-stack.mjs`。
- 文档：`platform/docs/deployment.md`、`platform/docs/local-development.md`、`.service-manager.md`。
- 运行时：新增默认宿主机端口 API `13000`、Worker health `13001`、Web `14173`；容器内固定为 `3000`、`3001`、`4173`，均可覆盖宿主机端口。
