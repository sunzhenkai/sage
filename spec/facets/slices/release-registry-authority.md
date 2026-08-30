# 切片:AgentPackageRelease 单一 authority

## 目标

Run 永远引用某个**固定** `release_id`,而不是「最新 Package」;Release Registry 是不可变供应链的事实主键。

## 入口

- 提交:`POST /v1/agent-packages` → `agent-package-release/compiler` → `agent-release-registry/api.submit`;
- 准入:`agent-run-admission/admitRun` 校验 `release_id` 处于 `accepted`;
- 读:`GET /v1/agent-packages/:id`、`GET /v1/runs/:runId` 均带 `release_id`。

## SOURCE

- `platform/packages/agent-package-release/src/{compiler,source-loader,source-manifest}.ts`
- `platform/packages/agent-release-registry/src/{api,production-admission}.ts`
- `platform/packages/agent-run-admission/src/{release-run,production-admission}.ts`
- `platform/scripts/agent-platform-final/check-public-surfaces.mjs`

## 契约

- [结构契约:AgentPackage 路由](../contracts/structure.md)
- [行为契约:签名失败必拒绝 + 准入测试](../contracts/behavior.md)
- [副作用契约:Release 登记](../contracts/side-effects.md)

## 处理线

- [AgentPackageRelease 准入](../../flows/release-admission.md)

## 生命周期

| 阶段 | 状态 |
|------|------|
| identified | ✅ |
| characterized | ✅(`docs/design/_cross/generic-agent-platform-final-architecture.md` + 源码对照) |
| specified | ✅(`@sage/agent-contracts` + Production Governance Schema) |
| implemented | ✅(Registry + Run Admission) |
| verified | ✅(`agent-run-admission/release-run.test.ts`、`agent-release-registry/production-admission.test.ts`) |
| canary | 不适用(单实现,无灰度) |
| migrated | 不适用 |
| retired | 不适用 |

## 副作用

- Release 登记 → `agent_package_releases`;
- 准入拒绝 → `state=rejected` + `rejection_reason`;
- Run 关联 → `agent_runs.release_id` 不可改。

## 验证方式

- 单元:`agent-package-release/compiler.test.ts`、`agent-run-admission/release-run.test.ts`;
- 集成:`pnpm check:agent-platform-final` 包含 `check-public-surfaces.mjs` 校验;
- 行为:`examples/production-governance-integration/src/fault-matrix.integration.test.ts`。
