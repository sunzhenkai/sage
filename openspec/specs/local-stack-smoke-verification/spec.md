# local-stack-smoke-verification Specification

## Purpose
TBD - defines repeatable full-stack smoke verification and automated runtime contract coverage for the local application stack.

## Requirements
### Requirement: Repeatable local stack smoke test
仓库 SHALL 提供一个可从 `platform/` 调用的整栈 smoke test，启动并清理本地 Compose 服务，验证六项服务健康和 Chat→Task→Worker→Web 纵向链路。

#### Scenario: Smoke test validates the complete local stack
- **WHEN** 执行 `corepack pnpm smoke:local`
- **THEN** 脚本校验 Compose 配置，执行 `up -d --build --wait`，验证 API `/livez`/`/readyz`、Worker `/readyz`、Web `/`，创建 Chat session/message，promotion 后等待 Task succeeded，并验证 Web API proxy

#### Scenario: Smoke test cleans up safely
- **WHEN** smoke test 成功或失败
- **THEN** finally 执行 `docker compose down --remove-orphans`，不删除 PostgreSQL/Artifact named volumes，失败输出服务状态和有限日志且不输出凭据

### Requirement: Automated runtime contract coverage
新增 runtime、health、配置和 smoke 编排行为 SHALL 有 targeted automated coverage，并与 workspace typecheck/build 一起运行。

#### Scenario: Runtime regression is detected
- **WHEN** 运行相关 Vitest、`corepack pnpm typecheck` 和 `corepack pnpm build`
- **THEN** 配置拒绝、健康状态、入口构建和 Web proxy 配置回归会使验证失败而不是静默跳过
