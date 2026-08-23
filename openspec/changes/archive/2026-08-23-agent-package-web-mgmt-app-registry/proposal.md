## Why
agent-web 要做应用包管理（新建 App 主体、软删除、上传/版本化），但 `agent-release-registry` 当前只有 Release 的登记/查询，没有 App 主体实体：包（packageId）没有独立的元信息（名称/描述），也没有删除语义。管理面的「新建 App、软删除」必须先在 registry 域建模，HTTP API 与 Web 界面才有依附。

本 change 是 taskflow driver `agent-package-web-mgmt-driver` 的子 change（切片 1/3），只负责 registry 域的 App 主体实体与软删能力。

## What Changes
- `agent-release-registry` 新增 `AgentApp` 主体实体与 `#apps` 索引（`tenant|appId → AgentApp`），`appId` 复用 `packageId` 标识空间
- `AgentReleaseStore` 新增方法：`createApp`、`listApps`（仅 active）、`getApp`（含 release 历史）、`softDeleteApp`（幂等，置 `status='deleted'`+`deletedAt`）
- 软删追加 append-only 审计（`action='app-delete'`）；Release 记录与既有审计保持不变
- 兼容性：`submit` 保持 app-agnostic，App 缺失时隐式登记占位 App（无 name/description），不破坏既有脚本/e2e/测试
- 软删后同名 appId 拒绝重建（返回稳定 conflict，保持审计清晰）
- 单测覆盖：createApp 冲突、listApps 过滤 deleted、getApp、softDeleteApp 幂等、submit 隐式占位 App、审计追加

## Capabilities

### Modified Capabilities
- `agent-release-registry` — 新增「App 主体管理与软删」requirement（ADDED）

## Non-goals
- 不做 HTTP 端点（属子 change `agent-package-web-mgmt-api`）
- 不做物理删除；release 与审计记录保留
- 不动 publish/rollback/channel 语义
- 不改既有 `listPackages`/`getPackageDetail` 行为（它们保持原样，供旧端点用）

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 会修改 platform/packages/agent-release-registry 与 openspec specs |

## 验收标准
- [ ] `createApp` 创建主体；重复 appId 返回稳定 conflict；软删后同名重建被拒
- [ ] `listApps` 仅返回 active App（按更新时间倒序、有界）
- [ ] `getApp` 返回主体元信息 + 该 App 的 release 历史；deleted App 返回 undefined
- [ ] `softDeleteApp` 幂等置 deleted，追加 `app-delete` 审计，不删除任何 release
- [ ] 既有 `submit`/`listPackages`/`getPackageDetail`/publish/rollback 行为与测试全部保持通过（无回归）
- [ ] `pnpm --filter @sage/agent-release-registry test` 与 `openspec validate --strict` 通过

## 验证记录
