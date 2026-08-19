# 补齐 Sage 本地应用启动入口并纳入 Compose

**id：** T0001
**status：** archived
**slug：** local-application-runtime
**创建时间：** 2026-08-13

---

## 概述

为 Sage 的 `agent-api`、`agent-worker`、`agent-web` 补齐可独立执行的本地运行入口和容器化单元，将三项应用与现有 PostgreSQL、Temporal、MinIO 基础设施统一纳入 Docker Compose，实现一条命令启动整套本地环境，并通过进程、端口及依赖感知的健康检查验证可用性。

## 背景

当前 `platform/compose.yaml` 只能启动 `postgres`、`temporal`、`artifact-store`。部署文档明确记录：三个 `apps/*` 包目前只有库、构建产物或测试 harness，没有完整的 runtime entrypoint、Dockerfile、Compose service 与健康检查。实际开发只能运行阶段性集成测试，无法稳定启动 API、Worker、Web 组成的本地应用栈，也无法让 `docker compose up -d --wait` 对整套服务给出统一的就绪结论。

已有基础包括：`agent-api` 已提供 `createChatApi()` 与路由构件；`agent-worker` 已提供 Temporal Activities；`agent-web` 已有 Vite 页面入口及 `/v1` 代理；现有 Compose 基础设施均已有健康检查。

## 目标

1. 为 `agent-api`、`agent-worker`、`agent-web` 提供明确、可重复的本地启动命令与 runtime entrypoint。
2. 完成本地依赖装配：API 可监听并访问所需存储/Agent 能力，Worker 可连接 `sage-dev` Namespace 与约定 Task Queue，Web 可访问 API。
3. 为三个应用提供可构建的容器单元，并加入 `platform/compose.yaml` 的依赖、网络、端口、配置和健康检查。
4. 使 `docker compose up -d --wait`（或等价 Makefile 命令）能够一键启动并验证 PostgreSQL、Temporal、MinIO、API、Worker、Web 全部本地服务。
5. 补充本地启动、配置、健康验证、日志与停止方式的文档和自动化验证。

## 现状缺口

| # | 缺口 | 类型 | 说明 | 建议补齐 |
|---|------|------|------|----------|
| 1 | API 缺少独立 bootstrap | 实现 | 已有 `createChatApi()`，但没有生产式依赖装配、固定监听入口、健康端点及信号退出处理。 | `/task-explore` 明确本地依赖装配后实现 |
| 2 | Worker 缺少独立进程入口 | 实现 | 目前仅导出 Activities，没有 Temporal Connection、`Worker.create()`、Task Queue、生命周期与就绪语义。 | `/task-explore` 明确 Worker 装配和健康模型后实现 |
| 3 | Web 缺少可编排启动单元 | 实现 | 已有 Vite 页面和代理配置，但无 `dev/start/serve` 脚本、容器服务及供 Compose 使用的 HTTP 健康检查。 | 调研最小本地静态服务/开发服务方案后实现 |
| 4 | 应用运行配置与依赖注入未定 | 信息 / 配置 | API 的 Store、AgentClient、Task Controller 等本地实现选择，Worker 的 Store/InputResolver/AgentClient 选择，以及端口、URL、Task Queue 环境变量需要统一。 | `/task-explore` 对照 P3-P6 harness 提炼最小可运行装配；未知项标为待确认 |
| 5 | 缺少应用镜像和 Compose 编排 | 资产 / 配置 | 三个应用均无 Dockerfile，Compose 仅含基础设施，尚无构建上下文、依赖顺序、持久化边界和应用健康检查。 | `/task-explore` 确定镜像复用与启动顺序后提案 |
| 6 | 缺少整栈自动验证 | 实现 | 当前检查覆盖构建和阶段集成测试，但没有“Compose 全部 healthy + API/Worker/Web 可用”的整栈 smoke test。 | 在提案中定义并实现可重复 smoke test |
| 7 | 文档与服务管理记录仍声明应用不可启动 | 资产 | `platform/docs/deployment.md`、`platform/docs/local-development.md` 与 `.service-manager.md` 需要在实现后同步真实命令、端口和排障方法。 | 实现验证后更新文档和服务缓存发现源 |
| 8 | 生产部署能力不在本任务范围 | 依赖确认 | P7 生产准入仍为 `NO-GO`；本需求只补本地开发/联调闭环，不应宣称生产可用。 | 在提案和文档中保持边界，无需本任务补齐生产审批 |

## 需求说明

### 功能与运行约束

- 每个应用必须有名称明确的启动脚本；命令从 `platform/` 或对应 workspace 包执行时行为一致。
- 运行参数通过环境变量或非敏感默认值提供；不得在任务或代码中新增生产密钥明文。
- Compose 应使用服务名进行容器间寻址，健康检查应验证服务自身关键能力，而不只验证 PID 存活。
- `agent-api` 应区分 liveness/readiness；readiness 至少反映关键依赖是否可用。
- `agent-worker` 的就绪判定应能反映已连接 Temporal 且可在约定 Namespace/Task Queue 上工作，具体实现待探索。
- `agent-web` 应能加载页面并把 `/v1` 请求指向 Compose 内的 API；本地宿主机端口应支持环境变量覆盖。
- 服务应支持正常停止，Compose 停止不得依赖删除数据卷。
- 保持现有 PostgreSQL、Temporal、Artifact 数据卷与默认端口兼容；如新增默认端口，必须记录并支持覆盖。

### 涉及面

| 逻辑库 | 路径 | 角色 |
|--------|------|------|
| Sage API runtime | `platform/apps/agent-api/` | 必须 |
| Sage Worker runtime | `platform/apps/agent-worker/` | 必须 |
| Sage Web runtime | `platform/apps/agent-web/` | 必须 |
| Sage 本地编排 | `platform/compose.yaml` | 必须 |
| Sage 本地编排 | `platform/Makefile` | 必须 |
| Sage 本地编排 | `platform/package.json` | 必须 |
| Sage 运行时依赖装配 | `platform/packages/` | 必须 |
| Sage 运行时依赖装配 | `platform/examples/p3-integration/` | 必须 |
| Sage 运行时依赖装配 | `platform/examples/p4-integration/` | 必须 |
| Sage 运行时依赖装配 | `platform/examples/p5-integration/` | 必须 |
| Sage 运行时依赖装配 | `platform/examples/p6-integration/` | 必须 |
| 容器构建资产 | `platform/` | 必须 |
| 验证与文档 | `platform/docs/deployment.md` | 建议 |
| 验证与文档 | `platform/docs/local-development.md` | 建议 |
| 整栈验证 | `platform/scripts/smoke-local-stack.mjs` | 建议 |
| 项目服务记录 | `.service-manager.md` | 建议 |
| 生产基础设施与 P7 审批 | 外部 HA PostgreSQL、生产 Temporal、Secret Manager、OIDC、负载均衡与生产发布 | 排除 |

- **目标仓库**：`.`（单仓，不跨仓）。
- **边界**：本任务交付本地开发/联调的一键运行体验，不改变当前生产 `NO-GO` 结论。

### 工作上下文

| 仓库 | 仓库路径 | checkout 路径 | worktree | 分支 | 基线 |
|------|----------|---------------|----------|------|------|
| Sage | `.` | `<worktree>` | 否，canonical checkout | `fix-workspace-usability` | `master` |

本任务实际写入的代码库为当前 Sage 单仓；未使用 linked worktree。

### 关联 OpenSpec

| change | 路径 | 说明 |
|--------|------|------|
| `local-application-runtime` | `openspec/changes/local-application-runtime/` | API/Worker/Web 本地 runtime、Compose 编排、健康检查和整栈 smoke 契约 |

### 设计文档

| 文档 | 类型 | 归档落点 |
|------|------|----------|
| `openspec/changes/local-application-runtime/design.md` | OpenSpec design | 归档时随 change 晋升/保留 |

## 验收标准

- [x] `agent-api`、`agent-worker`、`agent-web` 均提供经验证的本地启动入口和 workspace 脚本；最终 host smoke 已启动三者并完成健康/页面验证。
- [x] 三个应用均具有可重复构建的容器单元，并在 `platform/compose.yaml` 中声明服务、配置、依赖关系、端口和健康检查；Dockerfile 三目标镜像已成功构建，隔离 Compose smoke 已成功启动。
- [x] 从干净的本地前置环境执行 `docker compose up -d --wait`（或文档规定的一条等价命令）可启动 PostgreSQL、Temporal、MinIO、API、Worker、Web，所有服务最终为 `healthy`；隔离 Compose smoke 已确认六服务全部 healthy。
- [x] API 的 liveness/readiness、Worker 的连接/轮询就绪状态、Web 的 HTTP 健康检查均已实现并由 host smoke 验证；API `/readyz` 返回 `{"status":"ready"}`，Worker readiness 返回 `RUNNING/POLLING/POLLING`。
- [x] Web 能加载且 `/v1` proxy 可访问；host smoke 已完成 Chat session/message、Chat Run `succeeded`、promotion 和 Worker Task `succeeded`，Task Queue 为 `sage-agent-task-v1`、Namespace 为 `sage-dev`。
- [x] 应用支持正常退出；host smoke finally 已安全停止 API/Worker/Web，Compose smoke 脚本使用 `docker compose down --remove-orphans` 且默认保留 volumes。
- [x] 配置项、默认端口、启动/停止/日志/排障步骤已更新到部署与本地开发文档；文档明确 local principal/PiHarness 边界，且保持生产 `NO-GO`，不新增生产密钥明文。
- [x] 新增或调整的启动、健康检查及编排行为已有测试或 smoke 覆盖；`corepack pnpm check` 已通过（lint、依赖边界、typecheck、117 passed tests、build），runtime targeted tests 和 Compose config 也已通过。

## 验证记录

| 验证项 | 结果 | 证据 |
|--------|------|------|
| OpenSpec | 通过 | `openspec validate local-application-runtime --strict` |
| 完整质量门禁 | 通过 | `corepack pnpm check`：lint、全部边界检查、typecheck、28 test files / 117 tests passed、workspace build |
| Runtime targeted tests | 通过 | API 2 tests、Worker 3 tests passed |
| Compose 配置 | 通过 | `docker compose config --quiet` |
| Host 纵向 smoke | 通过 | API/Worker ready；Web HTML 与 `/v1` proxy；Chat Run、promotion Task 均 succeeded |
| 正式 Node 24 Docker build | 通过 | `docker compose up -d --build --wait` 在隔离 project 中成功构建 agent-api、agent-worker、agent-web 镜像；Docker context 排除了 `**/*.tsbuildinfo`，并修复 Web runtime 启动命令。 |
| 完整 Compose smoke | 通过 | `node scripts/smoke-local-stack.mjs` exit 0；六服务 healthy，Chat session/message、promotion、Temporal Task 和 Web proxy 全部通过；session=`session-54fb34c6-ea9f-4e62-a604-9448e6515fa0`，task=`task-7e57ecd4-4e20-4f8e-b551-35efe5a20c93`。 |

## 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-13 | 创建任务，状态 draft；根据现有应用、Compose 与部署文档补全涉及面、现状缺口和验收标准 |
| 2026-08-14 | 修复 Docker fresh build 的 tsbuildinfo 污染和 agent-web runtime pnpm 启动命令；正式 Node 24 三镜像 build、六服务 Compose healthcheck/--wait、完整 local stack smoke、`corepack pnpm check`、Compose config 与 OpenSpec strict validation 全部通过，任务完成 |
