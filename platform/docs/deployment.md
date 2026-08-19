# Sage Platform 部署文档

> 文档状态：与当前仓库实现一致，更新日期：2026-08-13。
>
> **重要边界：当前仓库只提供可执行的本地/联调基础设施部署，不提供完整的生产应用部署。** 本文将已实现的 Compose 部署与尚未实现的生产部署分开说明，不能把本地 Compose 当作生产方案。

## TL;DR

当前可执行的是 `platform/` 下的本地/联调 Compose 应用栈；API、Worker、Web 已形成仅限本地/联调的 runtime，但不构成生产部署方案。

### 服务总览

| 服务 | 作用 | 依赖/启动关系 | 默认访问地址 |
|---|---|---|---|
| `postgres` | Chat、Task Projection、Agent State 数据库 | Docker named volume `postgres-data`；自身无上游依赖 | `127.0.0.1:15432` |
| `temporal` | Workflow、Timer、Signal、Activity Retry 运行时 | 依赖 `postgres` 健康；Namespace 为 `sage-dev` | `127.0.0.1:17233` |
| `artifact-store` | 本地 S3-compatible Artifact 存储及控制台 | Docker named volume `artifact-data`；独立于 PostgreSQL/Temporal | API `127.0.0.1:19000`；控制台 `127.0.0.1:19001` |
| `agent-api` / `agent-worker` / `agent-web` | 应用 API、Temporal Worker、React/Vite Web | 依赖 PostgreSQL/Temporal；由本地 Dockerfile 和 Compose 启动并健康检查 | API `127.0.0.1:13000`；Worker health `127.0.0.1:13001`；Web `127.0.0.1:14173` |

### 资源依赖

| 类别 | 必需资源 | 用途/要求 |
|---|---|---|
| 宿主机运行时 | Node.js `24.14.0`、Corepack/pnpm `10.33.0` | 安装依赖、执行检查、构建和集成测试 |
| 容器运行时 | Docker Engine + Docker Compose | 构建并启动六个 Compose 服务，等待健康检查 |
| 持久化资源 | `postgres-data`、`artifact-data` | 保存数据库和 Artifact；删除 volume 会删除本地数据 |
| 网络端口 | `15432`、`17233`、`19000`、`19001`、`13000`、`13001`、`14173` | 分别映射基础设施、API、Worker health 和 Web；冲突时覆盖对应 `SAGE_*_PORT` |
| 外部生产资源 | HA PostgreSQL、生产 Temporal、Artifact backend、Secret Manager、OIDC/Registry | 当前仓库未提供生产实现；P7 生产准入目前为 **NO-GO** |

### 配置总览

| 配置项 | 默认值 | 作用 |
|---|---|---|
| `SAGE_POSTGRES_PORT` | `15432` | PostgreSQL 宿主机端口 |
| `SAGE_TEMPORAL_PORT` | `17233` | Temporal 宿主机 gRPC 端口 |
| `SAGE_ARTIFACT_PORT` | `19000` | MinIO API 宿主机端口 |
| `SAGE_ARTIFACT_CONSOLE_PORT` | `19001` | MinIO 控制台宿主机端口 |
| `P2_POSTGRES_URL`、`P3_POSTGRES_URL`、`P4_POSTGRES_URL`、`P5_POSTGRES_URL`、`P6_POSTGRES_URL` | `postgres://sage:sage-local-only@127.0.0.1:15432/sage` | 对应阶段集成测试的 PostgreSQL 连接串；自定义端口时同步修改 |
| `SAGE_TEMPORAL_ADDRESS` | `127.0.0.1:<SAGE_TEMPORAL_PORT>` | P4/P5/P6 集成测试的 Temporal 地址 |
| PostgreSQL 固定本地配置 | 用户/密码/数据库：`sage` / `sage-local-only` / `sage` | 仅限本地/联调，不得直接用于生产 |
| Temporal 固定本地配置 | Namespace `sage-dev`；Task Queue `sage-agent-task-v1` | 本地 Workflow/Worker 路由约定 |
| MinIO 固定本地配置 | `sage-local` / `sage-local-password` | 仅限本地/联调，不得直接用于生产 |

最小启动路径：

```bash
cd platform
corepack pnpm install --frozen-lockfile
docker compose up -d --wait
docker compose ps
```

## 1. 部署范围与现状

### 1.1 当前可执行部署

部署入口位于 `platform/`：

- `platform/compose.yaml`：启动本地基础设施和 API/Worker/Web 应用。
- `platform/Makefile`：提供依赖安装、质量检查、构建、测试和基础设施命令。
- `platform/package.json`：提供集成测试、`smoke:local` 和 P7 受控演练命令。

Compose 当前启动六个服务：

| 服务 | 镜像 | 容器端口 | 默认宿主机端口 | 用途 |
|---|---|---:|---:|---|
| `postgres` | `postgres:17.6-alpine` | 5432 | 15432 | Chat、Task Projection、Agent State 等 PostgreSQL 数据 |
| `temporal` | `temporalio/auto-setup:1.29.1` | 7233 | 17233 | 本地 Temporal Server，默认 Namespace 为 `sage-dev` |
| `artifact-store` | `quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z` | 9000/9001 | 19000/19001 | 本地 S3-compatible Artifact Store 与控制台 |
| `agent-api` | 本地 `Dockerfile` target `agent-api` | 3000 | 13000 | Fastify Chat/Task API；`/livez`、`/readyz` |
| `agent-worker` | 本地 `Dockerfile` target `agent-worker` | 3001 | 13001 | Temporal Worker health；固定 `sage-dev`/`sage-agent-task-v1` |
| `agent-web` | 本地 `Dockerfile` target `agent-web` | 4173 | 14173 | Vite preview；`/v1` 代理到 API |

数据卷为：

- `postgres-data`：PostgreSQL 数据。
- `artifact-data`：MinIO 数据。

### 1.2 本地应用运行边界

`agent-api`、`agent-worker`、`agent-web` 现在提供本地/联调 runtime，但不是生产部署单元：

- `agent-api`：`dev`/`start` 入口，使用本地 `PiHarness`、PostgreSQL Store 和可信本地 routing；健康端点为 `/livez`、`/readyz`。
- `agent-worker`：`dev`/`start` 入口，连接 `sage-dev` Namespace 的 `sage-agent-task-v1` Task Queue；health server 为 `/livez`、`/readyz`。
- `agent-web`：`dev`/`preview` 入口，Vite `server.proxy`/`preview.proxy` 将 `/v1` 转发到 API；preview 仅用于本地/联调，不是生产静态服务器。

本地 API 的固定 principal、Pi harness 和空 credential 仅在 `SAGE_DEPLOYMENT_MODE=local` 下启用；MinIO 当前仍是独立基础设施，未被声称为 API/Worker 的 Artifact Adapter。生产镜像、负载均衡、生产身份、Secret Manager、Artifact backend 和发布审批仍不在本任务范围，P7 生产状态保持 **NO-GO**。

## 2. 前置条件

在 `platform/` 下执行命令前，准备：

- Node.js `24.14.0`，版本见 [`.node-version`](../.node-version)。
- pnpm `10.33.0`，由 `package.json` 的 `packageManager` 和 Corepack 管理。
- Docker Engine 与 Docker Compose，且当前用户有权访问 Docker daemon。
- 可用磁盘空间：PostgreSQL 和 Artifact 数据会写入 Docker named volume。
- 如运行集成测试，宿主机默认端口 `15432`、`17233` 以及相应测试依赖端口不能被其他进程占用。

建议先确认版本：

```bash
node --version
corepack pnpm --version
docker --version
docker compose version
```

## 3. 配置

仓库没有要求提交 `.env` 文件；Compose 变量通过环境变量覆盖默认值。

### 3.1 Compose 端口变量

| 变量 | 默认值 | 映射 | 说明 |
|---|---:|---|---|
| `SAGE_POSTGRES_PORT` | `15432` | `${SAGE_POSTGRES_PORT}:5432` | 宿主机 PostgreSQL 端口 |
| `SAGE_TEMPORAL_PORT` | `17233` | `${SAGE_TEMPORAL_PORT}:7233` | 宿主机 Temporal gRPC 端口 |
| `SAGE_ARTIFACT_PORT` | `19000` | `${SAGE_ARTIFACT_PORT}:9000` | 宿主机 MinIO API 端口 |
| `SAGE_ARTIFACT_CONSOLE_PORT` | `19001` | `${SAGE_ARTIFACT_CONSOLE_PORT}:9001` | 宿主机 MinIO 控制台端口 |

例如，端口冲突时可以只覆盖宿主机端口：

```bash
export SAGE_POSTGRES_PORT=25432
export SAGE_TEMPORAL_PORT=27233
export SAGE_ARTIFACT_PORT=29000
export SAGE_ARTIFACT_CONSOLE_PORT=29001
```

应用和测试使用的默认连接信息为：

```text
PostgreSQL: postgres://sage:sage-local-only@127.0.0.1:15432/sage
Temporal:    127.0.0.1:17233
Namespace:   sage-dev
Task Queue:  sage-agent-task-v1
MinIO API:   http://127.0.0.1:19000
MinIO UI:    http://127.0.0.1:19001
```

如覆盖端口，连接 URL 也必须同步覆盖。集成测试支持的变量包括：

- `P2_POSTGRES_URL`
- `P3_POSTGRES_URL`
- `P4_POSTGRES_URL`
- `P5_POSTGRES_URL`
- `P6_POSTGRES_URL`
- `SAGE_TEMPORAL_ADDRESS`

### 3.2 本地凭据限制

Compose 中的 PostgreSQL 和 MinIO 凭据是本地开发固定值：

- PostgreSQL 用户/密码/数据库：`sage` / `sage-local-only` / `sage`。
- MinIO root 用户/密码：`sage-local` / `sage-local-password`。

这些值只能用于本地或一次性联调，不能直接用于生产。生产凭据应通过已批准的 Secret Manager、身份和轮换流程提供；当前仓库没有实现生产 Secret Manager Adapter。

## 4. 首次部署（本地/联调）

以下命令从仓库根目录执行：

```bash
cd platform

# 1. 按锁文件安装依赖
corepack pnpm install --frozen-lockfile

# 2. 检查 Compose 配置语法
docker compose config --quiet

# 3. 启动并等待 PostgreSQL、Temporal、MinIO 健康
docker compose up -d --wait

# 4. 查看服务状态
docker compose ps
```

> 如果复制命令执行，请去掉上面两行命令前的多余空格；标准命令为 `docker compose config --quiet` 和 `docker compose up -d --wait`。

也可以使用 Makefile：

```bash
make install
make infra-up
make infra-health
```

Makefile 的 `infra-up` 等价于 `docker compose up -d --wait`，`infra-health` 只执行 `docker compose ps`，不替代业务验证。

### 4.1 基础设施验证

```bash
# PostgreSQL readiness
docker compose exec -T postgres pg_isready -U sage -d sage

# MinIO liveness
curl --fail http://127.0.0.1:${SAGE_ARTIFACT_PORT:-19000}/minio/health/live

# 查看 Compose 健康状态和最近日志
docker compose ps
docker compose logs --tail=100 postgres temporal artifact-store
```

Temporal 的健康检查已写在 Compose 中；`docker compose ps` 中应看到服务为 `healthy`。Namespace 可使用已安装的 Temporal CLI 验证：

```bash
temporal operator namespace describe \
  --namespace sage-dev \
  --address 127.0.0.1:${SAGE_TEMPORAL_PORT:-17233}
```

如果本机没有 `temporal` CLI，以 Compose 健康状态和集成测试结果为准；仓库没有单独安装 CLI 的脚本。

## 5. 应用栈健康与业务 smoke

```bash
# 构建、启动并等待六项服务 healthy
corepack pnpm smoke:local
# 或
make smoke-local

# 仅查看状态和应用日志
docker compose ps
docker compose logs --tail=100 agent-api agent-worker agent-web

# 应用健康端点
curl --fail http://127.0.0.1:${SAGE_API_HOST_PORT:-13000}/livez
curl --fail http://127.0.0.1:${SAGE_API_HOST_PORT:-13000}/readyz
curl --fail http://127.0.0.1:${SAGE_WORKER_HEALTH_HOST_PORT:-13001}/readyz
curl --fail http://127.0.0.1:${SAGE_WEB_HOST_PORT:-14173}/
```

`smoke:local` 会创建本地 Chat session/message，验证 Chat Run、promotion、Temporal Worker Task succeeded 和 Web `/v1` proxy；结束时执行 `docker compose down --remove-orphans`，保留 named volumes。默认应用宿主端口为 API `13000`、Worker health `13001`、Web `14173`，可分别通过 `SAGE_API_HOST_PORT`、`SAGE_WORKER_HEALTH_HOST_PORT`、`SAGE_WEB_HOST_PORT` 覆盖。

## 6. 代码质量、构建与集成验证

基础设施启动后，建议按以下顺序验证：

```bash
# 静态质量、依赖边界、类型、单元测试和构建
corepack pnpm check
```

`check` 等价于：

```bash
corepack pnpm lint
corepack pnpm check:deps
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

按能力验证真实 PostgreSQL/Temporal 的集成链路：

```bash
# Agent State、Artifact/Credential fake、Tool pipeline
corepack pnpm test:p2:integration

# Chat Store、Fastify Chat API、SSE 与 React contract
corepack pnpm test:p3:integration

# PostgreSQL + Temporal Task/Worker 链路
corepack pnpm test:p4:integration
corepack pnpm test:p5:integration

# Chat/Task reconciliation 与真实 E2E
corepack pnpm test:p6:e2e
```

P2-P6 命令会按脚本需要启动部分 Compose 服务，并默认使用 `15432`/`17233`。如果使用了自定义端口，应同时设置对应的 URL 或 `SAGE_TEMPORAL_ADDRESS`。

P7 受控演练可使用：

```bash
corepack pnpm test:p7:unit
corepack pnpm test:p7:exercises
```

P7 演练会在本地 Compose 和隔离文件系统中执行备份恢复、租户删除审计、Worker 版本回滚等检查；其证据明确标记为 `production_evidence: false`，不能作为生产上线批准。

## 6. 数据初始化与迁移

当前没有独立的生产迁移 CLI 或 Compose migration service。数据库迁移由实际 Store 实例的 `migrate()` 调用触发；集成测试会在创建 Store 后执行迁移。

已提交的迁移包括：

- `packages/agent-state-postgres/migrations/001_agent_state.sql`
- `packages/task-domain/migrations/001_task_store.sql`
- `packages/chat-domain/migrations/001_chat.sql`

因此：

1. 仅执行 `docker compose up` 只会启动空的 PostgreSQL，不代表应用 schema 已完成初始化。
2. 当前仓库没有可供生产直接执行的迁移顺序、锁、审批或回滚脚本。
3. 在实现正式 API/Worker 部署单元前，应补充一次性 migration job、数据库连接 Secret、迁移锁和向后兼容策略。
4. 不要通过删除 `postgres-data` 解决迁移或数据问题，除非明确确认本地数据可丢失。

## 7. 停止、重启与清理

### 7.1 保留数据停止

```bash
docker compose down --remove-orphans
```

重新启动：

```bash
docker compose up -d --wait
docker compose ps
```

### 7.2 重启单个服务

```bash
docker compose restart postgres
docker compose restart temporal
docker compose restart artifact-store
```

Temporal 依赖 PostgreSQL 健康状态；重启 Temporal 前先确认 PostgreSQL 已恢复。

### 7.3 删除本地数据

以下命令会删除 PostgreSQL 和 Artifact 的 named volume，属于不可逆的本地数据清理：

```bash
docker compose down --volumes --remove-orphans
```

只有在确认本地数据可丢失时才执行。生产环境不得使用此命令作为回滚或故障修复手段。

## 8. 备份、恢复与数据操作

P7 脚本默认面向本地/隔离演练，并通过环境变量阻止误操作。正式生产使用前必须替换为经批准的连接、角色、存储和审计配置。

### 8.1 PostgreSQL

备份要求：非 root、使用最小权限备份角色、通过 `.pgpass`（权限 `0600`）、工作负载身份或批准的 Secret Provider 提供连接认证，不要把密码放在命令行参数或日志中。

```bash
cd platform

PGHOST=... PGPORT=... PGUSER=... PGDATABASE=... \
SAGE_BACKUP_ROLE_CONFIRMED=YES \
scripts/p7/postgres-backup.sh /secure/backup/sage.dump
```

恢复只能进入新建的隔离数据库：

```bash
PGHOST=... PGPORT=... PGUSER=... PGDATABASE=<isolated_recovery_db> \
SAGE_RESTORE_ISOLATED=YES \
scripts/p7/postgres-restore.sh /secure/backup/sage.dump
```

脚本会校验 `.sha256`，恢复使用 `pg_restore --exit-on-error --single-transaction`。恢复后还必须检查 schema、行数/引用计数、租户边界、`pg_restore --list` 和应用读取结果；不要把本地演练耗时解释成已批准的生产 RTO/RPO。

### 8.2 Artifact

Artifact 备份按租户前缀执行，禁止跨租户归档：

```bash
scripts/p7/artifact-backup.sh \
  /approved/artifact-root TENANT_ID /secure/backup/tenant.tar

SAGE_RESTORE_ISOLATED=YES \
scripts/p7/artifact-restore.sh \
  /secure/backup/tenant.tar /isolated/empty-dir
```

保留期删除必须先 dry-run，再由已批准的策略和审计记录驱动 apply：

```bash
scripts/p7/artifact-retention-delete.sh \
  /approved/artifact-root TENANT_ID APPROVED_CUTOFF audit.jsonl

scripts/p7/artifact-retention-delete.sh \
  /approved/artifact-root TENANT_ID APPROVED_CUTOFF audit.jsonl --apply
```

当前生产保留期、法律保留和删除 SLA 均未完成批准；在此之前不要启用自动生产删除。

## 9. 回滚策略

### 9.1 本地 Compose 回滚

本地 Compose 镜像版本已经在 `compose.yaml` 中固定。回滚应回到一个已验证的 Git 修订版本，再重新安装和启动：

```bash
# 在确认目标修订版本后执行；不要删除数据卷
git checkout <approved-revision>
cd platform
corepack pnpm install --frozen-lockfile
docker compose config --quiet
docker compose up -d --wait
docker compose ps
```

回滚后至少重新执行 `corepack pnpm check` 以及与变更相关的集成测试。不要通过 `docker compose down --volumes` 回滚数据库数据。

### 9.2 Worker 版本回滚边界

仓库的 Worker Runbook 要求每个 Workflow bundle 使用不可复用的 Build ID，并在候选版本通过 replay、poller 和 soak gate 后再逐级放量。生产回滚选择原来的 immutable predecessor Build ID，不重新构建或复用候选 ID。具体命令和限制见 [`p7-worker-versioning-runbook.md`](./p7-worker-versioning-runbook.md)。

当前仓库没有可直接执行的生产 Worker 发布脚本；Runbook 中的 Temporal CLI 命令是经过审批的生产流程模板，不等于仓库已有生产部署能力。

### 9.3 不允许的回滚方式

- 不把 API/Worker 切换到未固定的另一个 Temporal Cluster。
- 不修改已启动 Task 的 target snapshot 来“绕过”目标故障。
- 不在 `effect_unknown` 未完成外部副作用核对时自动重试写操作。
- 不使用删除数据库 volume、删除 Temporal History 或删除审计记录来掩盖发布问题。

## 10. 故障排查

### 10.1 端口占用

```bash
docker compose ps
ss -ltnp | grep -E ':(15432|17233|19000|19001)'
```

停止冲突进程，或在启动前覆盖对应 `SAGE_*_PORT`。自定义端口后，测试 URL 和 Temporal address 也必须同步调整。

### 10.2 PostgreSQL 不健康

```bash
docker compose logs --tail=200 postgres
docker compose exec -T postgres pg_isready -U sage -d sage
docker volume ls | grep postgres-data
```

先检查磁盘、端口、volume 权限和容器日志。除非数据明确可丢弃，不要删除 `postgres-data`。schema 问题应检查 Store 的 `migrate()` 和对应 SQL，而不是反复重建数据库。

### 10.3 Temporal 不健康

```bash
docker compose ps temporal postgres
docker compose logs --tail=200 temporal
```

先确认 PostgreSQL 已 `healthy`，再检查 Temporal auto-setup 日志、`17233` 端口和 Namespace `sage-dev`。集成测试连接地址必须与实际映射端口一致。

### 10.4 MinIO 不健康

```bash
docker compose logs --tail=200 artifact-store
curl --fail http://127.0.0.1:${SAGE_ARTIFACT_PORT:-19000}/minio/health/live
docker volume inspect sage-mvp_artifact-data
```

检查磁盘空间、volume 权限和端口映射。Artifact 引用应保持为 `artifact://...`；不要把 Artifact 内容或凭据写入 Chat/Task 数据库。

### 10.5 `pnpm install --frozen-lockfile` 失败

确认 Node/pnpm 版本与 `.node-version`、`package.json` 一致，并确保没有修改 `pnpm-lock.yaml`：

```bash
node --version
corepack pnpm --version
git diff -- platform/pnpm-lock.yaml
corepack pnpm install --frozen-lockfile
```

不要在部署环境使用普通 `pnpm install` 造成依赖漂移。

### 10.6 集成测试连接失败

确认：

1. Compose 服务已启动且为 `healthy`。
2. PostgreSQL URL 使用宿主机映射端口，而不是容器端口 `5432`。
3. Temporal 地址使用宿主机映射端口，而不是容器端口 `7233`。
4. `P*_POSTGRES_URL` 与测试编号匹配。
5. 测试进程不是在错误的工作目录运行；命令应从 `platform/` 执行。

### 10.7 应用 runtime 启动失败

先检查应用日志和配置：

```bash
docker compose ps agent-api agent-worker agent-web
docker compose logs --tail=200 agent-api agent-worker agent-web
curl --fail http://127.0.0.1:${SAGE_API_HOST_PORT:-13000}/readyz
curl --fail http://127.0.0.1:${SAGE_WORKER_HEALTH_HOST_PORT:-13001}/readyz
```

API/Worker 启动阶段会在 PostgreSQL advisory lock 下串行执行 Chat/Task migration，避免并发 migration deadlock。Worker readiness 必须同时满足 `RUNNING`、workflow/activity `POLLING`；应用使用的本地 principal、Pi harness 和 credential 不得用于生产。若 Docker build 报 Docker Hub DNS/网络错误，先确认能拉取固定的 `node:24.14.0-bookworm-slim`，不要改用未批准的基础镜像。

## 11. 生产部署准入清单（当前未通过）

在声称“平台已生产部署”之前，至少需要补齐并由责任人批准：

- API、Worker、Web 的正式部署单元、镜像和版本不可变标识。
- API 监听、反向代理/负载均衡、认证、健康检查和优雅退出。
- Worker 的 Temporal namespace、task queue、poller、Build ID 和兼容回滚方案。
- PostgreSQL 的 HA、PITR、备份恢复、RLS/权限、RTO/RPO 和迁移作业。
- 生产 Artifact backend、版本/复制/删除/恢复策略。
- Registry、Secret Manager、OIDC/身份和最小权限配置。
- 日志、指标、Trace、告警阈值、Dashboard 和 on-call roster。
- 租户隔离、数据分类/驻留、保留期、法律保留和删除审计。
- 生产演练证据及安全、架构、运维三方外部审批。

在上述事实和审批未完成前，正式结论保持 **NO-GO**；本地 Compose 只能用于开发、联调和受控工程验证。

## 12. 常用命令速查

```bash
cd platform

# 依赖、基础设施、检查
make install
make infra-up
make infra-health
make check

# 单项质量检查
make lint
make deps
make typecheck
make test
make build

# 集成验证
corepack pnpm test:p2:integration
corepack pnpm test:p3:integration
corepack pnpm test:p4:integration
corepack pnpm test:p5:integration
corepack pnpm test:p6:e2e
corepack pnpm test:p7:exercises

# 停止/清理
make infra-down                         # 保留 volumes
docker compose down --volumes --remove-orphans  # 删除本地数据，谨慎执行
```
