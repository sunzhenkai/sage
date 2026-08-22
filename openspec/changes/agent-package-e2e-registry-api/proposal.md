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
- [ ] 三类端点可用且 preValidation 拒绝未知字段（对齐既有 API 风格）
- [ ] 同一源包重复登记幂等（同 releaseId 返回既有记录，不报错）
- [ ] 列表/详情返回 manifest 摘要与资产清单（含 digest）
- [ ] 集成测试与静态检查通过

## 验证记录
