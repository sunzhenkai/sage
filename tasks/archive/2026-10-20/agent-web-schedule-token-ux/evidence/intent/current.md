# 定时任务与服务令牌现状（只读摸底）

## 结论
1. 文案里的“服务令牌”不是“实际执行任务的服务”，而是本部署 agent-api 的静态共享 API key（`SAGE_SERVICE_TOKEN_HASHES` 中的 key）。`src/service-token.ts:5`：`Authorization: Bearer <token>`，sha256 哈希注入、逗号分隔多 key 可轮换；认证后 principal 为 `service-token://<fingerprint>`，roles 固定为 `schedule-operator, package-registrar, task-operator, effect-resolver`。
2. 定时任务真正执行链路：Temporal 定时触发 → agent-worker（`schedule-activities` / `schedule-runtime`）→ 调用 agent-api 派发 → 按 release 与 invocation.task 跑任务。令牌只用于管理 `/v1/schedules`（建/查/暂停/恢复/删/触发历史）以及 packages/apps/runs/resolutions/MCP。
3. 是否支持多服务：当前不支持“每个服务一把令牌”或“按服务隔离”。同一 tenant 下所有服务令牌等价，拥有同一组 roles，没有 per-service / per-schedule 的权限边界。多 key 只用于轮换，不是多主体。
4. 当前 schema 也没有 `serviceId` / `targetService` 字段；定时任务定义只有 `releaseBinding`（FIXED / FOLLOW）与 `invocation.task`。

## 出处
- `platform/apps/agent-api/src/service-token.ts:5-11, 13-43`
- `platform/apps/agent-api/src/runtime.ts:247-278`
- `platform/apps/agent-api/src/schedules-api.ts:11-12, 63-66`（所有管理端点统一走 service token）
- `platform/packages/app-contracts/src/index.ts:451-464`（ScheduleDefinition 无服务字段）
- `platform/apps/agent-worker/src/schedule-runtime.ts`、`schedule-activities.ts`（执行侧）
- UI 文案：`platform/apps/agent-web/src/lib/locales/zh-CN.ts:141,361-364,681,733-734`
- 设置页：`platform/apps/agent-web/src/pages/settings.tsx:124`
- 全局错误提示：`platform/apps/agent-web/src/components/ui/misc.tsx:74-86`（任何 401 / AUTHENTICATION 都套“需要服务令牌”）

## 歧义
- 用户说的“服务”可能指“后端服务 agent-api”（是，令牌是给它的）或“执行任务的服务/worker”（不是）。文案只用“服务令牌”一词，容易让人误以为要填执行服务的地址/账号。
- 用户原话“是否支持多服务”也可能指多部署（多 agent-api 实例）、多租户或多个业务服务。当前是单 tenant + 多把等价 key。
