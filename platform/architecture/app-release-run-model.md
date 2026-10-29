# Sage App / Release / Run 模型（当前实现）

> 本文只描述仓库当前已实现的模型与链路，用于区分「可变主体」「不可变版本」「一次运行」。目标态架构见 `generic-agent-platform-final*`，两者不要混用。

## 1. 一句话模型

**App 是唯一可变主体；Draft 是 App 当前可编辑的源文件集合；Release 是发布时冻结的不可变快照；Run 是「Release 输入快照 + Task 执行」。**

Package 不再是独立实体：它只作为历史兼容名留在 Release 载荷、运行输入表和运行结果 schema 中（见 §8）。

| 概念 | 语义 | 主要定义 |
|------|------|----------|
| `AgentApp` | 主体与生命周期（`active` / `deleted`），持有元数据与唯一草稿；`appId` 复用 `packageId` 标识空间 | `packages/agent-release-registry/src/index.ts` → `AgentApp` |
| `AppDraft` | App 当前可编辑的源文件集合；`revision` 为并发控制版本，`revision: 0` 表示新建后的空草稿 | 同上 → `AppDraft` |
| `StoredRelease` | 不可变版本：发布时的 `app.yaml` 版本、`releaseId`（`sha256:…`）与源文件快照 | 同上 → `StoredRelease`、`publishAppRelease` |
| Run | 一次 Release 运行：准入时把任务与输入固化为 `task_package_input` | `packages/agent-run-admission`、`apps/agent-api/src/runs-api.ts` |
| `Task` | 运行的实际执行载体；状态、事件、日志、产物都挂在 task 上 | `packages/task-domain`、`apps/agent-api/src/task-api.ts` |

## 2. 标识与生命周期

- **单一 ID 命名空间**：App 使用 `appId`；Release 载荷中的 `packageId` 恒等于 `appId`。不存在 App ↔ Package 映射表。
- **草稿 revision**：新建 App 返回 `revision: 0` 的空草稿；保存草稿、导入压缩包、修改元数据都会递增 revision。写请求用 `If-Match: "r<N>"` 声明期望版本，缺失时按当前版本处理，不匹配返回 409 `APP_DRAFT_CONFLICT` 且不修改数据。
- **发布**：只读取当前草稿，客户端提交 `baseRevision`；草稿为空返回 400 `APP_DRAFT_EMPTY`；`app.yaml` 的 `id` 必须等于 `appId`（否则 400 `APP_DRAFT_INVALID`）；发布成功后 Release 仍保留在 App 下。
- **版本唯一**：同一 App 下 `packageVersion` 唯一。同版本同内容（`sourceFilesDigest` 一致）幂等返回既有 Release（`status: existing`）；同版本不同内容返回 409 `RELEASE_VERSION_CONFLICT`，不产生第二个 Release。
- **Release 不可变**：发布时冻结源文件快照（`sourceFiles` + `sourceFilesDigest`）与编译产物索引；后续草稿变化不影响既有 Release。
- **软删墓碑**：删除 App 只把状态改为 `deleted` 并记 `deletedAt`，保留 Release 与 Task；同名 App 不能重建（`APP_ALREADY_EXISTS`），保持审计清晰。
- **App 删除不级联**：Release、Task、`task_package_input` 均保留；`getApp` 对已删除 App 返回 `undefined`，控制台不再列出。

## 3. 主链路

```
新建 / 编辑草稿
  POST /v1/apps
    → AgentApp（draft r0）
  PUT /v1/apps/:appId/draft（If-Match）
  POST /v1/apps/:appId/draft/import（multipart tar/tar.gz/zip）
    → AppDraft（revision++、digest 更新）

发布
  POST /v1/apps/:appId/releases { baseRevision }
    → loadSourcePackageFromFiles（读取草稿 app.yaml）
    → compileSourcePackage（manifest / entries / assets / provenance）
    → publishAppRelease
    → StoredRelease（releaseId、contentDigest、sourceFiles 快照）

控制台运行
  POST /v1/releases/:releaseId/runs（local-only）
    → resolveRelease → provider 依赖检查 → task/params 校验
    → admitPackageRun → task_package_input → controller.create → Temporal Task

调度运行
  schedule trigger（packages/agent-run-admission/src/schedule-trigger.ts）
    → 同一 admission → task_package_input（taskId 以 `pkg-sched-` 开头）
    → FIXED：锚定 releaseId + contentDigest，漂移则 `SCHEDULE_BINDING_DRIFTED`
    → FOLLOW：解析锚点 App 的最新 Release，缺同名 task 或参数非法则 `SCHEDULE_BINDING_INCOMPATIBLE`
```

## 4. API 映射

| 资源 | 端点 | 实现 |
|------|------|------|
| App | `GET /v1/apps`、`POST /v1/apps`、`GET /v1/apps/:appId`、`PATCH /v1/apps/:appId`、`DELETE /v1/apps/:appId` | `apps/agent-api/src/apps-api.ts` |
| 草稿 | `GET/PUT /v1/apps/:appId/draft`、`POST /v1/apps/:appId/draft/import`、`GET /v1/apps/:appId/draft/export` | 同上 |
| 发布 / Release | `POST/GET /v1/apps/:appId/releases`、`GET /v1/apps/:appId/releases/:releaseId`、`GET .../export?format=source\|bundle` | 同上 |
| Release 运行 | `POST /v1/releases/:releaseId/runs` | `apps/agent-api/src/runs-api.ts` |
| App 运行历史 | `GET /v1/apps/:appId/runs`、`GET /v1/apps/:appId/runs/:taskId` | `apps/agent-api/src/app-runs-api.ts` |
| Task | `GET /v1/tasks`、`GET /v1/tasks/:taskId`、`.../events`、`.../run-logs`、`.../artifacts`、控制操作 | `apps/agent-api/src/task-api.ts` |

- `/v1/packages*` 已移除，访问返回 404；控制台 `/packages` 重定向到 `/apps`。
- App 列表返回 `draftRevision`、`draftDigest`、`hasUnpublishedChanges`、`latestVersion` 与 `releaseCount`。
- App 详情同时返回最新 Release 的 manifest / assets；每个 Release 行附带摘要（运行弹窗直接生成 task/params 表单）。
- Release 详情返回 manifest、assets、provenance 与 `sourceFilesDigest`；source 导出仅含源文件，bundle 额外包含 `release.json`。
- 旧 Release 缺少源快照时，导出降级为 lock assets 与生成的 `manifest.json`，并设置 `X-Source-Snapshot: unavailable`。

## 5. 运行历史的查询模型

运行清单的事实源是 `task_package_input`，状态的事实源是 Task 投影：

```
task_package_input                         TaskProjectionView
  tenant_id, task_id, release_id,           task_id, status, revision,
  release_digest, created_at                failureCode, freshness, updatedAt
        │                                          │
        └──────────── 按 task_id 逻辑连接 ──────────┘
```

- `task_package_input` 在准入成功、workflow 启动前写入，带 `release_id`、`release_digest` 与输入快照；索引 `(tenant_id, release_id, created_at)` 支持按 App 的多个 Release 倒序取运行。
- `TaskProjectionView` 不含 `releaseId`，因此运行历史必须从运行输入表出发，再逐条取投影状态；没有投影表示已准入但尚未被协调器观测，返回 `status: "pending"`。
- `taskId` 以 `pkg-sched-` 开头表示 schedule 触发，其余为控制台 / API 手动触发。
- 运行详情不返回 `assembledInput`，避免把输入快照暴露到控制台。

## 6. 不变量

1. App 是唯一可变主体；Release 内容不可变，同一 `releaseId` 的源快照与 lock 不随新版本变化。
2. 草稿写入必须匹配 revision；冲突时不修改当前草稿。
3. Release 必须属于 App，且同一 App 下版本唯一；同版本不同内容被拒绝。
4. Release 保存发布时的源文件快照，后续草稿变化不影响已发布内容。
5. 运行只通过 Release 发起；准入时校验所属 App 仍为 `active`，否则返回 404 `APP_DELETED`。
6. App 删除不删除 Release / Task / `task_package_input`。
7. 一次运行对应一个 `taskId`；同一 `taskId` 的输入快照只写一次。
8. FIXED 调度不漂移：锚点 digest 不一致即稳定失败；FOLLOW 调度始终解析锚点 App 的最新 Release。

## 7. 当前限制

- release registry 与 App 存储是**进程内存态**：agent-api 重启后 App / Release 消失；`task_package_input` 仍在，但按 App 已不可达，需要重新导入。
- Schedule **控制面记录与预算账户在 Postgres**（与 dispatcher 共用）；创建 schedule 时按 definition.budget 开通账本账户。App/Release 仍为内存，锚点 Release 重启后仍需重新导入。
- 运行准入 local-only：控制台与本地 API 可发起；生产准入不属于当前能力。
- package run 的日志与产物仍由 Task 链路提供，本模型不新增日志存储或保留策略。
- 运行历史 v1 只做最近 N 条（默认 50、最大 100），不做游标分页；状态查询按条读取投影。
- 尚无按 App 的权限模型、Release channel 与 App/Release 的 Postgres 持久化。

## 8. 兼容名与后续

以下名称保留，但都指向同一 App/Release 模型，不构成第二个实体：

| 兼容名 | 位置 | 语义与去处 |
|--------|------|------------|
| `ReleasePayload.packageId` / `packageVersion` | `packages/agent-contracts`、`StoredRelease` | 线上 Release 载荷的既有字段名，值分别等于 `appId` 与发布版本；改名需协议大版本，暂保留 |
| `task_package_input` | Postgres 表 / 运行输入 | 运行历史事实源，列名 `release_id` / `release_digest` 已是 Release 语义；后续迁移可重命名为 `task_release_input` |
| `PackageRunResult.v1` | `POST /v1/releases/:releaseId/runs` 响应 schema | 运行准入结果 schema 名；后续可引入 `AppRunResult.v1` 别名，当前保持线上兼容 |
| `StoredRelease.packageId` 等字段与 registry 方法名 | `agent-release-registry` | 内部兼容命名，随持久化改造统一 |

后续能力（不在当前实现内）：Postgres 持久化、Release channel、按 App 的权限、运行历史分页。
