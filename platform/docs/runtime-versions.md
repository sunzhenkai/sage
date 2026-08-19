# P0 运行时版本与许可决策

记录日期：2026-08-12。所有版本在 `package.json`、`.node-version` 与 `pnpm-lock.yaml` 中精确锁定。

| 组件 | 版本 | 许可 | 分发/升级结论 |
|---|---:|---|---|
| Node.js | 24.14.0 | MIT | Active LTS 基线；升级需完整质量检查 |
| pnpm | 10.33.0 | MIT | 通过 `packageManager` 与 Corepack 锁定 |
| TypeScript | 5.9.3 | Apache-2.0 | 保守选择 5.x，避免把首版绑定到 TS 7 新行为 |
| `@mariozechner/pi-agent-core` | 0.73.1 | MIT | npm 已标记迁移到 `@earendil-works/*`；P1 仍由 `harness-pi` 隔离，迁移需新 Spike |
| `@mariozechner/pi-ai` | 0.73.1 | MIT | 与 Pi Core 同版本精确锁定 |
| Temporal TypeScript SDK | 1.22.0 | MIT | 所有 `@temporalio/*` 包保持同版本；Workflow bundle 与 Worker 必须同版本 |
| PostgreSQL image | 17.6-alpine | PostgreSQL | 仅本地 profile |
| Temporal Server image | 1.29.1 | MIT | 仅本地 profile；生产兼容矩阵另行批准 |
| MinIO image | RELEASE.2025-09-07T16-13-09Z | AGPLv3 | 仅本地开发，不嵌入或再分发；生产 Artifact Adapter 不绑定 MinIO |

第三方声明文件通过 `skipLibCheck` 隔离，但 Sage 源码保持 strict、`noUncheckedIndexedAccess` 和 `exactOptionalPropertyTypes`。pnpm 安装时默认不执行未批准的第三方构建脚本；如后续运行路径需要 native 构建，必须审查后显式批准。

## P3 precise application versions

| Component | Version | Purpose |
|---|---:|---|
| Fastify | 5.11.3 | Chat REST and SSE API |
| React / React DOM | 19.2.8 | Minimum Chat UI and server-rendered integration evidence |
| Vite | 8.2.1 | Browser application build |
| `@vitejs/plugin-react` | 6.0.5 | React/Vite compilation |
| PostgreSQL `pg` | 8.23.0 | Real ChatStore transactions and integration tests |

All P3 manifests use exact versions; `pnpm-lock.yaml` is validated with `pnpm install --frozen-lockfile`.
