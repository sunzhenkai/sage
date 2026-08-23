## Why
编译出的 Release 需要登记处与查询面：agent-api 当前没有任何包/Release 端点，前端与运行入口都无法「看见」包。`agent-release-registry` 包已有存储与校验逻辑，缺 HTTP 暴露与编译登记入口。

## What Changes
- agent-api 新增包管理端点：`POST /v1/packages/{packageId}/releases`（上传源包目录或预编译 Release 登记）、`GET /v1/packages`（列表）、`GET /v1/packages/{packageId}`（详情含 release 历史）
- 登记 flow：接收源包 → 调用编译器 → 校验 → 写入 registry（幂等：同 releaseId 重复登记返回既有记录）
- 提供 CLI/脚本入口把本地目录编译并登记到运行中的 agent-api

## Capabilities

### New Capabilities

（无）

### Modified Capabilities
- `agent-release-registry` — ADDED「包管理 HTTP 端点与编译登记」requirement

## Non-goals
- 不做包删除/撤销/active pointer 治理（终版架构受控发布另行立项）
- 不做多租户配额与审批

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | platform/apps/agent-api、platform/packages/agent-release-registry、openspec specs |

## 验收标准
- [x] 三类端点可用且 preValidation 拒绝未知字段（对齐既有 API 风格）
- [x] 同一源包重复登记幂等（同 releaseId 返回既有记录，不报错）
- [x] 列表/详情返回 manifest 摘要与资产清单（含 digest）
- [x] 集成测试与静态检查通过

## 验证记录

- `pnpm --filter @sage/agent-release-registry test`：23/23 通过（含新增 package index 2 项）
- `pnpm --filter @sage/agent-api` typecheck/build 通过
- `npx vitest run apps/agent-api/src/packages-api.test.ts`：6/6 通过（登记/幂等/非法拒绝/未知字段/列表/详情）
- `npx vitest run apps/agent-api/src/`（排除 integration/p6/p7）：52/52 通过，无回归
- `npx eslint` 新文件与 registry index 通过；`node scripts/check-dependencies.mjs`：Dependency boundaries OK
- `openspec validate --strict --type change agent-package-e2e-registry-api` 通过
- 实现说明：新增 `apps/agent-api/src/packages-api.ts`（3 个端点 + TypeBox 契约 + preValidation）、`apps/agent-api/scripts/register-package.ts`（本地登记脚本）；`agent-release-registry` 的 `AgentReleaseStore` 新增 `listPackages/getPackageDetail` 与 `#byPackage` 索引；agent-api 新增对 `agent-package-release`/`agent-release-registry` 的依赖并更新 `package-ownership.json` 与 tsconfig
