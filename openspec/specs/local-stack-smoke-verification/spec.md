# local-stack-smoke-verification Specification

## Purpose

为本地全栈提供基于真实 provider 凭据门控的可重复冒烟验证，覆盖服务健康与 API 面，并在未注入凭据时安全跳过模型调用链路。

## Requirements

### Requirement: 真实 provider 冒烟与凭据门控垂直链路

仓库 SHALL 提供一个可从 `platform/` 调用的整栈 smoke test，启动并清理本地 Compose 服务，验证六项服务健康与 API 面。系统 SHALL 不存在任何由环境变量驱动的进程内确定性模型替身；smoke 环境 SHALL 在验证开始前 seed 一条凭据在场的工作区 provider 条目与运行 agent 设置（仅覆盖 API 面，不发起模型调用）；模型调用垂直链路（Chat→promotion→Task）SHALL 仅在操作者显式注入完整真实凭据（`SAGE_BOOTSTRAP_PROVIDER_API_KEY` / `SAGE_BOOTSTRAP_PROVIDER_BASE_URL` / `SAGE_BOOTSTRAP_PROVIDER_MODEL`，经 Compose 透传并由 agent-api 启动引导幂等注册 deployment-env 条目）时执行；未注入时 smoke SHALL 跳过该链路并正常通过。

#### Scenario: Smoke test validates services and API surface

- **WHEN** 执行 `corepack pnpm smoke:local`
- **THEN** 脚本校验 Compose 配置，执行 `up -d --build --wait`，验证 API `/livez`/`/readyz`、Worker `/readyz`、Web `/`，seed 工作区 provider 与运行 agent 设置，创建 Chat session 并验证 Web API proxy events 响应

#### Scenario: 模型调用垂直链路凭据门控

- **WHEN** 注入三项 `SAGE_BOOTSTRAP_PROVIDER_*` 后执行 `corepack pnpm smoke:local`
- **THEN** agent-api 已注册 deployment-env provider，Chat 发送经真实外部 provider 获得回复，promotion 成功且 Task 到达 succeeded、taskQueue 契约匹配
- **WHEN** 未注入上述任一变量
- **THEN** smoke 输出跳过说明后以 0 退出，全程不发起任何真实模型调用

#### Scenario: Smoke test cleans up safely

- **WHEN** smoke test 成功或失败
- **THEN** finally 执行 `docker compose down --remove-orphans`，不删除 PostgreSQL/Artifact named volumes，失败输出服务状态和有限日志且不输出凭据

### Requirement: Automated runtime contract coverage

新增 runtime、health、配置和 smoke 编排行为 SHALL 有 targeted automated coverage，并与 workspace typecheck/build 一起运行。

#### Scenario: Runtime regression is detected

- **WHEN** 运行相关 Vitest、`corepack pnpm typecheck` 和 `corepack pnpm build`
- **THEN** 配置拒绝、健康状态、入口构建和 Web proxy 配置回归会使验证失败而不是静默跳过
