# agent-package-web-mgmt-driver Design

## Context

见 proposal.md - Why。

现状基线（均已核实代码）：

- `platform/packages/agent-release-registry` 的 `InMemoryAgentReleaseStore` 以 `#byPackage`（`tenant|packageId → StoredRelease[]`）索引已登记 Release，`listPackages`/`getPackageDetail` 只读派生；Release 是 create-only、immutable（spec `agent-release-registry` 明示「相同 identity 不同 payload 拒绝覆盖」），**无 App 主体概念、无删除能力**。
- `platform/apps/agent-api/src/packages-api.ts` 已暴露 `POST /v1/packages/{packageId}/releases`（上传源包文件 → 编译 → 登记，幂等）、`GET /v1/packages`（列表）、`GET /v1/packages/{packageId}`（详情含 manifest 摘要/资产预览/release 历史）；登记**无前置主体要求**，packageId 直接取自源包 manifest.id。
- `platform/apps/agent-web/src/packages.tsx` 的 Packages 域只有列表/详情/发起运行，无任何管理动作（新建/更新/删除/上传）。

用户已确认的两个关键决策：

- **删除 = 软删除**：包标记为 deleted，从用户可见列表隐藏；Release 记录与审计保留（不破坏 create-only/immutable）。
- **新建 = 应用主体管理**：应用（App）有主体管理，必须先新建 App，再上传包。

## Goals / Non-Goals

**Goals:**

- registry 增加 App 主体层：显式创建/查询/软删 App，App 是包的归属主体；上传 release 前置要求 App 存在且 active（fail closed）
- agent-api 暴露 App CRUD 与「上传到 App（版本化）」HTTP 端点
- agent-web 提供应用包管理界面：新建 App、上传/更新（每次上传生成新版本）、删除 App、版本历史查看
- 既有包浏览/发起运行行为保持不变

**Non-Goals（设计层）:**

- 不引入 App ↔ Package 的多对多层级——`appId == packageId`，App 与其版本化包是 1:1（App 是主体元信息，Release 是其版本化内容）
- 不做物理删除；release 记录与 append-only 审计保留
- 不动 publish/rollback/channel 治理语义
- 不做权限审批流、多租户配额（沿用既有 authenticator 风格）
- 不破坏既有 `/v1/packages` 兼容端点行为（web 切到 apps 视图，旧端点保留只读/登记兼容）

## Decisions

### D1 App 主体实体：registry 新增 App 层，`appId == packageId`

在 `agent-release-registry` 包新增 `AgentApp` 主体记录与 `#apps` 索引（`tenant|appId → AgentApp`）：

```
AgentApp {
  tenantId, ownerNamespace, appId,
  name, description,
  status: 'active' | 'deleted',
  createdAt, updatedAt, deletedAt?
}
```

- `appId` 直接复用 `packageId` 标识空间（同一标识，避免双标识/双索引）；Release 的 `packageId` 即其归属 App。
- 新增 store 方法：`createApp`（appId 冲突→稳定 conflict）、`listApps`（只返回 active）、`getApp`（含 release 历史）、`softDeleteApp`（置 deletedAt/status）。
- **兼容性**：既有 `submit` 路径保持 app-agnostic——若 App 不存在则隐式登记一个无 name/description 的占位 App（向后兼容脚本/e2e/既有测试）；显式 `createApp` 才设置 name/description。管理面（新端点）要求 App 必须显式存在。
- 备选：App 与 Package 分离成两级实体（否——本轮诉求是「应用即包的主体」，两级层级徒增复杂度）；复用 `#byPackage` 加 deleted 标记而不建 `#apps`（否——App 需要 name/description/status 独立元信息，且 listApps 语义不同）。

### D2 删除 = 软删除（tombstone），不破 immutable

- `softDeleteApp` 只写 `status='deleted'` + `deletedAt`，不触碰任何 StoredRelease / 审计记录；append-only 审计追加一条 `action='delete'` 记录。
- `listApps` 过滤 deleted；`getApp`/`getPackageDetail` 对 deleted App 返回 `undefined`（HTTP 404）。
- 备选：物理删除（否——违反 create-only/immutable 契约，且破坏审计与已运行 Attempt 的 release 引用）；纯前端隐藏（否——后端无删除语义，不持久）。

### D3 上传（版本化）前置 App 存在，管理面 fail closed

- 新端点 `POST /v1/apps/{appId}/releases` 上传源包：先校验 App 存在且 active，再走既有「校验 → 编译 → 登记」链（`loadSourcePackageFromFiles` → `compileSourcePackage` → `store.submit`），每次上传生成一个新版本 release。
- 强校验源包 manifest.id 与路径 appId 一致，不一致返回稳定错误（防串主体）。
- 既有 `POST /v1/packages/{packageId}/releases` 端点保留：内部对缺失 App 隐式占位登记，行为不变（兼容 register-package.ts 脚本与 e2e）。
- 备选：让所有上传统一走 apps 端点并废弃 packages 端点（否——破坏既有脚本与已归档 e2e 验收，迁移面大）。

### D4 HTTP 端点（agent-api，对齐既有 authenticator/错误风格）

| 方法 | 路径 | 语义 |
|------|------|------|
| `POST` | `/v1/apps` | 新建 App 主体 `{ appId, name, description }`；appId 冲突→409 |
| `GET` | `/v1/apps` | App 列表（active，join 最新 release 版本/时间/摘要） |
| `GET` | `/v1/apps/{appId}` | App 详情（元信息 + manifest 摘要 + 资产预览 + release 历史） |
| `DELETE` | `/v1/apps/{appId}` | 软删 App（幂等） |
| `POST` | `/v1/apps/{appId}/releases` | 上传源包登记为该 App 的新版本（前置 App 存在） |

### D5 Web：Packages 域升级为「应用包管理」

- 复用 `packages.tsx` 的 `PackagesApp`/`PackageList`/`PackageDetailView` 骨架与既有样式/locale 体系，数据源切到 apps 端点。
- 列表页：顶部新增「新建 App」入口（表单：appId/name/description）；空态引导新建。
- 详情页：新增「上传/更新版本」表单（上传源包文件 → 新版本）、「删除 App」按钮（二次确认 + 结果反馈）；保留 manifest/资产/release 历史/发起运行。
- 版本化呈现：release 历史按版本倒序展示，每次上传后自动刷新。
- 备选：新建独立 Apps 页面与 Packages 并存（否——同一域拆两页造成导航与数据割裂）。

### D6 切片拆分（子 change，均同 planning root）

| # | 子 change | 交付 | 依赖 |
|---|-----------|------|------|
| 1 | `agent-package-web-mgmt-app-registry` | registry 包：App 主体实体（create/list/get/softDelete）+ 软删审计 + 单测；spec delta（`agent-release-registry` 或新 capability） | — |
| 2 | `agent-package-web-mgmt-api` | agent-api：App CRUD + 上传端点 + 鉴权 + 单测/集成测试；spec delta | 1 |
| 3 | `agent-package-web-mgmt-web` | agent-web：应用包管理界面（新建/上传更新/删除/版本历史）+ locale + 样式 + 单测；spec delta（`package-management-interface`） | 2 |

依赖链为串行（1 → 2 → 3）：API 依赖 registry 实体，Web 依赖 API 契约。

## Risks / Trade-offs

- [store `submit` 隐式占位 App 与「必须先建 App」的管理面约束并存，语义不完全一致] → 隐式仅为兼容旧端点；管理面（新 apps 端点）严格 fail closed，文档化两条路径的差异
- [App 元信息（name/description）无后端强校验可能被注入超长/非法内容] → 端点层加长度/字符集上界校验，与现有 id 校验风格一致
- [软删后同名 appId 重建的语义（tombstone 复用 vs 拒绝）] → 本轮采用「软删后允许重建同名 App（复活为 active，历史 release 重新可见）」或「拒绝重建」，apply 时取一并在 spec delta 固化；倾向拒绝重建以保持审计清晰
- [web 上传走 files record（内存物化），大包有内存压力] → 沿用现有 512KB/文件上限与 512 路径上限，不放大

## Migration Plan

- 全部为增量：registry 新增 `#apps` 索引与方法、agent-api 新增 apps 端点、agent-web 界面增强；不改既有 release 存储结构与旧端点行为。
- 回滚 = 移除新端点/前端入口与 `#apps` 索引；已登记 Release/App 数据保留只读，不影响运行链路。

## Open Questions

- App `name`/`description` 的具体校验上界（不阻塞：apply 时对齐现有 id 校验取合理上界，如 name≤128、description≤2048）
- 软删后同名 appId 是否允许重建（不阻塞：见 Risks，apply 时取「拒绝重建」并在 spec delta 固化）
