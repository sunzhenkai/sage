# Sage App / Package / Release / Run 模型（当前实现）

> 本文只描述仓库当前已实现的模型与链路，用于区分「包主体」「版本索引」「不可变版本」「一次运行」。目标态架构见 `generic-agent-platform-final*`，两者不要混用。

## 1. 一句话模型

**App 是主体与生命周期，Package 是它的版本索引，Release 是不可变版本，Run 是「Release 输入快照 + Task 执行」。**

| 概念 | 语义 | 主要定义 |
|------|------|----------|
| `AgentApp` | 包的主体与生命周期（`active` / `deleted`），`appId` 复用 `packageId` 标识空间 | `packages/agent-release-registry/src/index.ts` → `AgentApp` |
| `Package` | 某个 `packageId` 的发布索引：最新版本、release 数量、内容摘要 | `AgentReleaseStore` → `listPackages` / `getPackageDetail` |
| `StoredRelease` | 不可变版本；`packageVersion` 与 `releaseId`（`sha256:…`）一一对应，重复提交按幂等键返回 existing | `packages/agent-release-registry/src/index.ts` → `StoredRelease`、`submit` |
| Run | 一次包运行：准入时把 Release 的任务与输入固化为 `task_package_input` | `packages/agent-run-admission`、`apps/agent-api/src/runs-api.ts` |
| `Task` | 运行的实际执行载体；状态、事件、日志、产物都挂在 task 上 | `packages/task-domain`、`apps/agent-api/src/task-api.ts` |

## 2. 标识与生命周期

- **同一 ID 命名空间**：`appId` 与 `packageId` 取同一值（例如 `lifecycle-probe`），App 与 Package 共享标识，不需要额外映射表。
- **占位 App**：既有 submit 路径保持 app-agnostic；当包首次提交且 App 不存在时，registry 隐式登记一个无 `name` / `description` 的 active App（`#ensurePlaceholderApp`）。控制台可再补名称与描述。
- **软删墓碑**：删除 App 只把状态改为 `deleted` 并记 `deletedAt`，保留 Release 与 Task；同名 App 不能重建（`APP_ALREADY_EXISTS`），保持审计清晰。
- **Release 不可变**：一个 `releaseId` 对应一份内容；运行输入在准入时物化，执行不读取后续版本。
- **App 删除不级联**：Release 与运行记录不被删除；但 `getApp` 对已删除 App 返回 `undefined`，控制台不再列出。

## 3. 三条链路

```
导入 / 上传
  Web ImportExampleApps / uploadRelease
    → agent-api apps-api / packages-api（compileSourcePackage）
    → AgentReleaseStore.submit → Package 索引 + 占位 App

控制台运行
  POST /v1/releases/:releaseId/runs（local-only）
    → resolveRelease → provider 依赖检查 → task/params 校验
    → admitPackageRun → task_package_input → controller.create → Temporal Task

调度运行
  schedule trigger（packages/agent-run-admission/src/schedule-trigger.ts）
    → 同一 admission → task_package_input（taskId 以 `pkg-sched-` 开头）
```

## 4. API 映射

| 资源 | 端点 | 实现 |
|------|------|------|
| App | `GET /v1/apps`、`POST /v1/apps`、`GET /v1/apps/:appId`、`DELETE /v1/apps/:appId` | `apps/agent-api/src/apps-api.ts` |
| App 发布 | `POST /v1/apps/:appId/releases` | 同上 |
| Package | `GET /v1/packages`、`GET /v1/packages/:packageId`、`POST /v1/packages/:packageId/releases` | `apps/agent-api/src/packages-api.ts` |
| Release 运行 | `POST /v1/releases/:releaseId/runs` | `apps/agent-api/src/runs-api.ts` |
| App 运行历史 | `GET /v1/apps/:appId/runs`、`GET /v1/apps/:appId/runs/:taskId` | `apps/agent-api/src/app-runs-api.ts` |
| Task | `GET /v1/tasks`、`GET /v1/tasks/:taskId`、`.../events`、`.../run-logs`、`.../artifacts`、控制操作 | `apps/agent-api/src/task-api.ts` |

App 详情同时返回最新 release 的 manifest / assets；每个 release 行附带 manifest 摘要（运行弹窗直接生成 task/params 表单）。Package 详情返回 manifest、assets 与 releases 索引。

## 5. 运行历史的查询模型

运行清单的事实源是 `task_package_input`，状态的事实源是 Task 投影：

```
task_package_input                         TaskProjectionView
  tenant_id, task_id, release_id,           task_id, status, revision,
  release_digest, created_at                failureCode, freshness, updatedAt
        │                                          │
        └──────────── 按 task_id 逻辑连接 ──────────┘
```

- `task_package_input` 在准入成功、workflow 启动前写入，带 `release_id`、`release_digest` 与输入快照；索引 `(tenant_id, release_id, created_at)` 支持按 App 的多个 release 倒序取运行。
- `TaskProjectionView` 不含 `releaseId`，因此运行历史必须从包输入表出发，再逐条取投影状态；没有投影表示已准入但尚未被协调器观测，返回 `status: "pending"`。
- `taskId` 以 `pkg-sched-` 开头表示 schedule 触发，其余为控制台 / API 手动触发。
- 运行详情不返回 `assembledInput`，避免把输入快照暴露到控制台。

## 6. 不变量

1. Release 不可变：同一 `releaseId` 的内容与 lock 不随新版本变化。
2. Release 必须属于 App：运行时先 `resolveRelease`，再校验 App / release 归属。
3. 运行准入 local-only：控制台与本地 API 可发起；生产准入不属于当前能力。
4. App 删除不删除 Release / Task / `task_package_input`。
5. 一次运行对应一个 `taskId`；同一 `taskId` 的输入快照只写一次。

## 7. 当前限制

- release registry 与 App 存储是**进程内存态**：agent-api 重启后 App / Release 消失；`task_package_input` 仍在，但按 App 已不可达，需要重新导入。
- package run 的日志与产物仍由 Task 链路提供，本模型不新增日志存储或保留策略。
- 运行历史 v1 只做最近 N 条（默认 50、最大 100），不做游标分页；状态查询按条读取投影。
