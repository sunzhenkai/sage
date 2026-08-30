# 构建(build/)

从干净环境到可运行 Sage。所有命令以 `cd platform && ...` 起头(workspace 根在 `platform/`)。

## 工具链

| 工具 | 版本 | 锁文件 |
|------|------|--------|
| Node.js | `24.14.0` | `platform/.node-version` |
| pnpm | `10.33.0` | `platform/pnpm-lock.yaml`、`packageManager` 字段 |
| TypeScript | `5.9.3` | 各包 `tsconfig.json` + `platform/tsconfig.base.json` |
| Vitest | `4.1.10` | — |
| Docker Compose | v2 | `platform/compose.yaml` |
| OpenSpec CLI | 见 `openspec/` | `openspec/config.yaml` |

## 依赖(必连外部服务)

| 依赖 | 用途 | 影响 |
|------|------|------|
| PostgreSQL 17.6 | 主数据 + Temporal DB | 启动 Postgres 才可启动应用 |
| Temporalio auto-setup 1.29.1 | Workflow 引擎 | 启动 Temporal 才可启动应用 |
| MinIO | Artifact Store | Checkpoint/Artifact 写入 |
| 模型 Provider API | LLM 调用 | 由 Provider Catalog 选,密钥由 Secret Vault 注入 |
| MCP 工具后端 | 工具调用 | 由 `tool-runtime` 解析 |

> 三方 npm 包与本地 pnpm 锁文件均在 `platform/pnpm-lock.yaml`,不进本镜像。

## 构建

```bash
cd platform
pnpm install            # 装 workspace 依赖
pnpm typecheck          # tsc -b + spikes tsconfig
pnpm build              # 各包 tsc,pnpm -r --if-present build
```

产物:`platform/packages/*/dist/`、`platform/apps/*/dist/`。

## 测试

```bash
cd platform
pnpm test                                       # 单元 + 集成(默认排除 p4/p5 集成)
pnpm test:p2:integration                        # Postgres-backed
pnpm test:p3:integration                        # Postgres-backed
pnpm test:p4:integration                        # Postgres + Temporal
pnpm test:p5:integration                        # Postgres + Temporal
pnpm test:p6:e2e                                # Postgres + Temporal
pnpm test:p7:unit                               # Pilot Admission
pnpm test:p8:unit                               # P8 调度面单元(contracts/fakes/迁移)
pnpm test:p8:integration                        # 真实 Temporal Schedules adapter 集成
pnpm test:p8:exercises                          # P8 压缩时钟 soak 演练(产出 evidence/p8)
pnpm test:production-governance:unit            # 生产治理单元
pnpm test:production-governance:postgres        # Postgres-backed(可重入)
pnpm test:production-governance:postgres:ephemeral  # 临时 Postgres
pnpm test:agent-platform-final:unit             # 终版架构 conformance
pnpm test:agent-platform-final:temporal         # Temporal replay corpus
pnpm smoke:local                                # 本地全栈冒烟
```

## 边界检查

```bash
pnpm check:deps                                 # 依赖/边界(已并入 check-p8-boundaries:canonical 契约不泄漏 Temporal 类型)
pnpm check:production-governance                # 生产治理总开关
pnpm check:agent-platform-final                 # 终版架构合规
pnpm scan:agent-platform-final                  # 边界 + System Model + Runtime Projection 校验
```

## 迁移

```bash
cd platform
pnpm test:production-governance:postgres        # 含 migration-preflight
# 或单独:
node scripts/production-governance/migration-preflight.mjs
```

迁移目录:按包存放 — `platform/packages/agent-state-postgres/migrations/`(001–009,应用启动/测试时由 `agent-state-postgres/src/index.ts` 有序装配执行;全新库先跑 004 RLS 引导)与 `platform/packages/task-domain/migrations/`(任务面 001–007,由 task-store-postgres 引用)。runner 在 `platform/packages/postgres-migrations/`。

## 启动

```bash
cd platform
docker compose up -d --wait postgres temporal artifact-store
docker compose up -d --build --wait agent-api agent-worker agent-web

# 校验
curl http://127.0.0.1:9610/readyz
curl http://127.0.0.1:9611/readyz
curl http://127.0.0.1:14173/
```

关闭:`docker compose down`(数据卷保留;`down -v` 才清)。

## 收尾验证

- `pnpm check:agent-platform-final` 跑通(包含 lint、typecheck、test:postgres:ephemeral、scan、conformance evidence、openspec validate);
- `pnpm evidence:agent-platform-final` 重新生成 evidence 资产;
- 详尽执行见 `evidence/agent-platform-final/`。
