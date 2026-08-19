## Context

Sage 只有 v1.1 验证架构和 P0–P7 实施计划，尚未有实现仓库。P0 是所有实现阶段的 Gate：Pi 与 Temporal SDK 的实际限制、许可、版本和本地依赖服务未被证实时，不能让应用契约绑定到供应商细节。

## Goals / Non-Goals

**Goals:** 建立可重复的 `platform/` pnpm monorepo；锁定运行时与依赖；用最小可运行程序记录 Pi/Temporal 兼容性；提供可替换 Adapter 与本地服务 profile；阻止不符合架构方向的 package 依赖。

**Non-Goals:** 不实现 Agent Loop、HTTP/UI、Task Router、生产控制面或全量外部服务集成。

## Decisions

- 使用精确版本和 lockfile，而非范围版本；版本、许可与升级策略写入 ADR/决策记录，避免环境漂移。
- 创建隔离 Spike：Pi 仅通过拟建 `harness-pi` 进行能力实验；Temporal 仅通过 bundle 后的 Worker/Workflow 实验 mTLS、Namespace、Build ID 与确定性。选择运行证据而非文档推断。
- 以 package 依赖检查防止 `agent-lib` 指向应用、Temporal、Fastify、数据库或 UI。将外部系统抽象为 Registry/Secret/OIDC/Artifact Adapter 和 local fake。
- 以 Docker Compose profile 提供 PostgreSQL、Temporal dev 和 S3-compatible store，并使健康检查成为本地 bootstrap 的一部分。

## Risks / Trade-offs

- [Pi 或 Temporal 能力/许可不满足] → 记录失败和 Adapter 回退点，阻断 P1 或 P4。
- [精确版本过早过期] → 版本升级仅走新的 Spike 与兼容性记录。
- [本地 fake 与目标后端偏离] → 以 port contract tests 约束两者。

## Migration Plan

创建独立 workspace 与本地 profile；CI 先执行 install/typecheck/test/build/依赖检查。发现 Spike 阻断时停止下游 change，替换 Adapter 或更新架构后重新评审；删除 P0 基线仅需移除尚未部署的开发资产。

## Open Questions

P0 必须关闭 Node/pnpm/TypeScript/Pi/Temporal 的具体版本和许可、Registry/Secret/OIDC/Artifact Owner、首版集群隔离原则。