# local-application-orchestration Specification

## Purpose
TBD - defines reproducible local application images, complete Compose orchestration, and dependency-aware health semantics.

## Requirements
### Requirement: Reproducible application images
本地 API、Worker、Web SHALL 各有可重复构建的容器目标，共用固定 Node/pnpm workspace 依赖和 lockfile，不引入未锁定依赖。

#### Scenario: Application targets build from platform context
- **WHEN** 从 `platform/` 执行 `docker compose build agent-api agent-worker agent-web`
- **THEN** 三个镜像使用 `pnpm-lock.yaml` 完成 frozen install 并成功构建对应 runtime 产物

### Requirement: Complete local Compose profile
Compose SHALL 编排 PostgreSQL、Temporal、Artifact Store、API、Worker 和 Web，并使用服务名寻址、依赖健康条件和可覆盖宿主端口。

#### Scenario: Full stack starts in dependency order
- **WHEN** 执行 `docker compose up -d --build --wait`
- **THEN** PostgreSQL/Temporal/Artifact Store 先达到 healthy，随后 API/Worker/Web 也达到 healthy，且默认应用宿主端口为 13000、13001、14173

#### Scenario: Port overrides do not change container contracts
- **WHEN** 设置 `SAGE_API_HOST_PORT`、`SAGE_WORKER_HEALTH_HOST_PORT` 或 `SAGE_WEB_HOST_PORT`
- **THEN** 仅宿主端口改变，应用容器仍使用 3000、3001、4173 及 Compose 服务名连接

### Requirement: Dependency-aware application health
Compose application healthchecks SHALL validate application protocol readiness rather than only process existence；API、Worker、Web 分别暴露可验证的 readiness/root semantics。

#### Scenario: API readiness reflects dependencies
- **WHEN** API 的 PostgreSQL 或 Temporal 依赖不可用
- **THEN** `/readyz` 返回非 2xx，Compose 不将 `agent-api` 标记为 healthy

#### Scenario: Worker readiness reflects pollers
- **WHEN** Worker 未进入 `RUNNING` 且 workflow/activity poller 未进入 `POLLING`
- **THEN** Worker `/readyz` 返回非 2xx

#### Scenario: Web health reflects HTTP serving
- **WHEN** Web preview 可返回构建后的 index
- **THEN** Web `/` healthcheck 返回 2xx，且 Web `/v1` 代理可访问 API
