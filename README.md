# 思极（Sage）

> 不止于思，极致于行

> 通用 Agent 平台 — Agent-first shared Kernel、可插拔 Engine、AgentPackageRelease → AgentTaskSpec → AgentExecutionEnvelope、Interactive/Durable 双 Host、Capability/MCP、Context/Model、Artifact/Checkpoint、Effect/Consumption Ledger 与单一 authority。

Sage 是一个面向多产品复用的 Agent 执行内核与运行时平台。当前仓库是 **Sage 单仓**：同时承载 Agent Library 与 Agent Application 两层，Chat Service 与 Temporal Activity 都通过同一个 Agent Library 执行 Agent Run，不复制 Agent Loop。

## 仓库结构

```
.
├── platform/         # 工作区根：apps / packages / examples / fixtures / docs / evidence
│   ├── apps/         # agent-api、agent-worker、agent-web
│   ├── packages/     # agent-contracts、tool-runtime、agent-state-postgres、…
│   └── docs/         # 部署、运维、phase exit evidence
├── docs/design/      # 架构与 MVP 设计文档（语言无关的 Contract）
├── openspec/         # OpenSpec 变更与 spec 演进
├── tasks/            # 任务交付台账与归档
└── .service-manager.md  # 本机服务启停说明（已 gitignore，不进版本控制）
```

## 技术栈

- **Language**: TypeScript (Node.js `24.14.0`)
- **Package Manager**: pnpm `10.33.0` (via Corepack)
- **Web**: React + Vite
- **API**: Fastify + HTTP/JSON + SSE
- **Workflow**: Temporal TypeScript SDK (`temporalio/auto-setup:1.29.1`)
- **Storage**: PostgreSQL `17.6` (Chat / Task Projection / Agent State) + S3-compatible Artifact Store (MinIO)
- **Harness**: PiHarness（首版固定）

## 快速开始（本地开发）

```bash
# 进入工作区
cd platform

# 启动本地基础设施（Postgres / Temporal / MinIO）
docker compose up -d --wait postgres temporal artifact-store

# 启动应用服务（Schedule 管理 UI 需先配置 dev service token）
TOKEN=$(openssl rand -hex 32)
printf 'SAGE_SERVICE_TOKEN=%s\nSAGE_SERVICE_TOKEN_HASHES=%s\n' "$TOKEN" "$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)" >> .env

docker compose up -d --build --wait agent-api agent-worker agent-web

# 健康检查
curl http://127.0.0.1:9610/readyz
curl http://127.0.0.1:9611/readyz
curl http://127.0.0.1:14173/
```

端口与启动细节见 `platform/docs/local-development.md` 与根目录的 `.service-manager.md`。

## 设计文档

- [Agent 项目 MVP 总览](docs/design/README.md)
- [Agent MVP 第一版实现架构](docs/design/first-version-system-architecture.md)
- [通用 Agent 平台终版架构](docs/design/_cross/generic-agent-platform-final-architecture.md)
- [MVP 1：通用 Agent Library](docs/design/agent-library-mvp.md)
- [OpenSpec 变更](openspec/)

## 阶段产物与治理

项目按 Phase（P0–P7）滚动交付，每个 Phase 都有：

- `docs/design/` 与 `openspec/changes/<change>/` 下的提案与 spec 演进
- `platform/docs/pN-*.md` 与 `platform/evidence/agent-platform-*` 下的 exit review / acceptance / 架构评审产物
- `tasks/archive/<date>-T<n>-<slug>/` 下的任务归档

## 状态

- 当前实现基线：v1.1（已交付）
- 长期目标态：[Sage 通用 Agent 平台终版架构](docs/design/_cross/generic-agent-platform-final-architecture.md)（待 System Model / Runtime DSL / Formal Architecture Review 升级为 validated baseline）

## 许可证

本仓库目前未声明开源许可证；如需对外分发或复用，请先与维护者确认授权范围。
