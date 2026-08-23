# agent-package-web-mgmt-app-registry Tasks

## 1. 实现

- [x] 1.1 在 registry 包定义 `AgentApp` 类型与 `AgentAppStatus`，新增 `#apps` 索引
- [x] 1.2 `AgentReleaseStore` 接口新增 `createApp`/`listApps`/`getApp`/`softDeleteApp`，`ReleaseRegistryAuditAction` 增加 `'app-create'/'app-delete'`，`ReleaseRegistryErrorCode` 增加 `APP_INVALID/APP_ALREADY_EXISTS/APP_NOT_FOUND/APP_DELETED`
- [x] 1.3 `InMemoryAgentReleaseStore` 实现四方法：createApp（冲突检测 + 软删 tombstone 拒绝重建）、listApps（过滤 deleted + 有界 + 倒序）、getApp（含 release 历史）、softDeleteApp（幂等 + 审计）
- [x] 1.4 `submit` 增加 App 隐式占位登记（App 缺失时建占位 App，不破坏既有行为）
- [x] 1.5 单测：createApp 冲突、软删重建拒绝、listApps 过滤、getApp、softDeleteApp 幂等/审计、submit 隐式占位
- [x] 1.6 静态检查与回归：`pnpm --filter @sage/agent-release-registry test`（32/32）、`typecheck`、`build`、eslint、`check-dependencies` 全通过；既有用例无回归
