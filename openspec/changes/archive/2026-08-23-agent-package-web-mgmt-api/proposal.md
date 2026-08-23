## Why
registry 域已有 App 主体实体（子 change 1），但 agent-api 还没有暴露 App 管理 HTTP 面。web 界面需要可调用的端点来新建 App、列出 App、查看详情、软删除、上传源包登记为新版本。

本 change 是 taskflow driver `agent-package-web-mgmt-driver` 的子 change（切片 2/3），负责 agent-api 的 App 管理与上传端点。

## What Changes
- `agent-api` 新增 App 管理路由（`registerAppsRoutes` 或扩展 packages-api）：
  - `POST /v1/apps`：新建 App 主体 `{ appId, name, description }`；appId 冲突→409；字段长度/字符集校验
  - `GET /v1/apps`：active App 列表，join 最新 release 版本/时间/摘要
  - `GET /v1/apps/{appId}`：App 详情（元信息 + manifest 摘要 + 资产预览 + release 历史）
  - `DELETE /v1/apps/{appId}`：软删 App（幂等）
  - `POST /v1/apps/{appId}/releases`：上传源包登记为该 App 新版本；前置校验 App 存在且 active；manifest.id 与 appId 一致性校验
- 复用既有 authenticator 风格（`x-authentication-id` 头 / `authenticateRequest`），错误码风格对齐 packages-api
- 既有 `/v1/packages` 端点行为不变（隐式占位 App 兼容）
- 单测 + 集成测试覆盖各端点与错误路径

## Capabilities

### Modified Capabilities
- `agent-release-registry` — 扩展「包管理 HTTP 端点」requirement（ADDED App 管理端点 scenario）或新增 requirement

## Non-goals
- 不动 registry 域实现（属子 change 1，已交付）
- 不做 web 界面（属子 change `agent-package-web-mgmt-web`）
- 不改既有 packages 端点行为
- 不做物理删除、权限审批

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 会修改 platform/apps/agent-api 与 openspec specs |

## 验收标准
- [ ] `POST /v1/apps` 新建主体，冲突/非法字段返回稳定错误
- [ ] `GET /v1/apps`、`GET /v1/apps/{appId}` 返回主体与 release 信息，deleted App 不可见
- [ ] `DELETE /v1/apps/{appId}` 幂等软删
- [ ] `POST /v1/apps/{appId}/releases` 前置校验 App 存在，manifest.id 一致才登记为新版本
- [ ] 既有 packages 端点测试无回归
- [ ] `pnpm --filter @sage/agent-api` 相关测试与 `openspec validate --strict` 通过

## 验证记录
