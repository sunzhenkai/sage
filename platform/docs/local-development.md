# Sage MVP 本地开发环境

## 前置条件

- Node.js `24.14.0`（见 `.node-version`）
- Corepack/pnpm `10.33.0`
- Docker Engine 与 Docker Compose

## 引导与验证

```bash
cd platform
corepack pnpm install --frozen-lockfile
docker compose up -d --wait
docker compose ps
corepack pnpm check
```

健康端点：PostgreSQL host 端口默认为 `15432`（容器内 `5432`）；Temporal gRPC 默认为 `localhost:17233`（容器内 `7233`）、默认 Namespace 为 `sage-dev`；Artifact Store 默认为 `http://localhost:19000/minio/health/live`，控制台为 `http://localhost:19001`。可通过 `SAGE_POSTGRES_PORT`、`SAGE_TEMPORAL_PORT`、`SAGE_ARTIFACT_PORT`、`SAGE_ARTIFACT_CONSOLE_PORT` 覆盖。

## 停止与清理

```bash
docker compose down --remove-orphans
# 仅在明确需要删除本地数据时执行：docker compose down --volumes
```

## 常见恢复

- **端口占用**：运行 `docker compose ps` 和 `ss -ltnp | grep -E ':(15432|17233|19000|19001)'`，停止冲突服务或覆盖对应 `SAGE_*_PORT` 后重试。
- **PostgreSQL 不健康**：查看 `docker compose logs postgres`；schema 初始化失败时先修复迁移，除非数据可丢弃，不要删除 volume。
- **Temporal 不健康**：先确认 PostgreSQL 健康，再查看 `docker compose logs temporal`；Namespace 可用 `temporal operator namespace describe --namespace sage-dev --address localhost:7233` 验证。
- **Artifact Store 不健康**：检查 `docker compose logs artifact-store`、本地磁盘空间和 volume 权限。
- **依赖漂移**：只运行 `corepack pnpm install --frozen-lockfile`；升级版本必须更新版本/许可记录并重跑 Spike。

Registry、Secret Manager 与 OIDC 在本地使用 `@sage/local-fakes`；Artifact contract tests 同时适用于内存 fake 与后续 S3 Adapter。替换实现不得改变 `@sage/platform-ports`。


## P2 安全状态集成验证

```bash
corepack pnpm test:p2:integration
```

该命令只启动 compose PostgreSQL，并以真实 `postgres:17.6-alpine` 运行 migration/Agent State contract，同时运行 Artifact/Credential fake failure injection 与 Tool pipeline 测试。默认 URL 为 `postgres://sage:sage-local-only@127.0.0.1:15432/sage`；可用 `P2_POSTGRES_URL` 或 `SAGE_POSTGRES_PORT` 覆盖。普通 `pnpm check` 中数据库 contract 会显式 skip，避免隐式依赖本地基础设施；P2 phase gate 必须单独运行本命令。

## P3 Chat integration verification

```bash
corepack pnpm test:p3:integration
```

This starts only compose PostgreSQL and runs the real Chat migration/store, Fastify endpoints and listening SSE stream, and React server-rendered contract integration. It covers multi-turn order, message-commit-before-LocalAgentClient invocation evidence, strict `afterSequence`, empty catch-up, restart/retry, Summary/Artifact-only handling, and correlated metrics. Override the database with `P3_POSTGRES_URL` or `SAGE_POSTGRES_PORT`.

## 应用服务

完整本地应用栈包含 `agent-api`、`agent-worker`、`agent-web`，默认宿主端口如下：

| 服务 | 宿主端口 | 健康/访问 |
|---|---:|---|
| `agent-api` | `9610` | `/livez`、`/readyz` |
| `agent-worker` | `9611` | `/livez`、`/readyz`；返回 `sage-dev` 和 `sage-agent-task-v1` |
| `agent-web` | `14173` | `/`；`/v1` 代理到 `agent-api` |

端口可通过 `SAGE_API_HOST_PORT`、`SAGE_WORKER_HEALTH_HOST_PORT`、`SAGE_WEB_HOST_PORT` 覆盖。应用容器内部端口固定为 API `9610`、Worker health `9611`、Web `4173`，容器间必须使用 Compose service name。

## 一键启动与 smoke

```bash
cd platform
corepack pnpm install --frozen-lockfile
corepack pnpm smoke:local
# 或：make smoke-local
```

`smoke:local` 会执行 `docker compose up -d --build --wait`，检查六项服务 healthy，创建 Chat session/message，验证 Chat Run、promotion、Temporal Worker Task succeeded 和 Web `/v1` proxy；成功或失败都会执行 `docker compose down --remove-orphans`，默认保留 named volumes。若希望保留服务供手工调试，可设置 `SMOKE_KEEP_SERVICES=1`。

开发模式也可以分别运行：

```bash
SAGE_DEPLOYMENT_MODE=local corepack pnpm --filter @sage/agent-api dev
SAGE_DEPLOYMENT_MODE=local corepack pnpm --filter @sage/agent-worker dev
SAGE_API_PROXY_TARGET=http://127.0.0.1:9610 corepack pnpm --filter @sage/agent-web dev
```

API/Worker 本地 runtime 使用 `PiHarness` 和固定 local principal，仅用于开发/联调；`SAGE_DEPLOYMENT_MODE` 不是生产身份开关。MinIO 当前作为独立本地基础设施运行，未声称已接入应用 Artifact Adapter。
