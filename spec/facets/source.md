# SOURCE

事实从哪来:Sage 自身代码、配置、测试、Phase Exit Evidence 与 OpenSpec 变更。

| 类别 | 路径 | 说明 |
|------|------|------|
| 源码 | `platform/apps/*/src` `platform/packages/*/src` | TS 实现 |
| 配置 | `platform/compose.yaml` `platform/Dockerfile` `platform/package.json` `platform/pnpm-workspace.yaml` `platform/tsconfig*.json` | 编排与构建 |
| Schema | `platform/packages/postgres-migrations` `platform/packages/*/migrations.ts` | 数据库 schema |
| 测试 | `platform/packages/*/*.test.ts` `platform/examples/*/src/*.test.ts` `platform/spikes/*` | Vitest |
| 证据 | `platform/evidence/*` `evidence/agent-platform-final/*` | Exit Review、Acceptance |
| 脚本 | `platform/scripts/*` `platform/scripts/agent-platform-final/*` | 边界、scan、preflight、validate |
| 文档 | `docs/design/*` `platform/docs/*` | 架构与运维 |
| 变更 | `openspec/changes/*` `openspec/specs/*` | 可执行契约 |
| 任务 | `tasks/archive/*` | 任务归档 |

> 三方安装树(`platform/node_modules/`、`platform/packages/*/node_modules/`、上游 npm 包的源码)与本仓依赖的其他仓库不进本镜像。Secret/Key 字面量不抄进镜像,详见 [surface/config.md](../surface/config.md) 的脱敏原则。
