## Why

workspace-provider-catalog-ux 上线后，添加 provider 弹窗存在三个体验缺陷：模型列表按名称正序排列，「最新的模型」淹没在长列表里；adapter 缺省启发会在每次重新选择 provider 时无条件覆盖用户已手改的适配器取值，形成「改了又被改回去」的往返；目录数据来自服务端 models.dev 快照（24h 定时同步），浏览器无法主动获取最新目录，新模型最长延迟一天可见且无手动刷新入口。

## What Changes

- **模型列表倒序（最新在前）**：Catalog projection 白名单新增 `releaseDate`（源字段 `release_date`，models.dev 100% 覆盖）；`GET /v1/provider-catalog/models` 默认排序改为 `status rank → releaseDate 新→旧 → normalized name → id`，弹窗内任何分页深度下最新模型都在最前。
- **adapter 不再被选择器覆盖**：弹窗引入 adapterDirty 跟踪——用户显式改写「适配器类型」后，后续 provider/model 选择 SHALL NOT 重置该取值；仅未手改时才应用 catalog 缺省启发。改写 adapter 也不清空已选 provider/model。
- **目录手动刷新**：弹窗目录区提供「刷新目录」按钮：触发既有 `POST /v1/provider-catalog/sync`（manual、`provider-catalog-admin` 授权、60s 限流），随后从最新快照重载列表第一页；429/403/失败以稳定文案提示，不阻塞手工录入。
- 不改变：快照/LKG/ETag 同步治理、projection whitelist 之外的 raw 保留语义、弹窗降级路径、provider connection API、凭据只写不读。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `provider-model-catalog`: 三处——①「Tolerant validation 与 whitelist projection」：`release_date` 提升为已使用字段，合法 ISO 日期进入 projection 为 `releaseDate`，非法类型整批拒绝；②「Catalog read 与 status API」：模型默认排序改为 status rank → releaseDate 新→旧 → normalized name/id；③「工作区 provider 添加弹窗的 Catalog 辅助选择」：新增 adapter 手改不被重置、模型最新在前、手动刷新（sync + 重载）三个场景。
- `web-interface-localization`: 「Provider 相关提示文案纳入统一翻译资源」增加目录刷新（刷新按钮、同步中、限流与失败提示）相关 message key。

## Impact

- **后端**：`platform/packages/provider-catalog/src/projection.ts`（release_date 校验与 releaseDate 字段）、`platform/packages/app-contracts`（`ModelCatalogItemSchema` 增加 optional `releaseDate`）、`platform/packages/provider-catalog/src/service.ts`（模型 sortKey 与 cursor key 调整）及对应单测/集成测试。
- **Web**：`platform/apps/agent-web/src/workspace-providers.tsx`（adapterDirty、刷新按钮与 sync 流程）、`locale.tsx`（新增键）、样式微调、`providers.test.tsx` 用例。
- **契约**：`ModelCatalogItem` 增加可选字段（非破坏）；模型默认排序变化对现有唯一消费方（弹窗）即目标行为；无存储 schema 变化（releaseDate 随 raw snapshot 重建 projection）。
- **验证**：provider-catalog 包测试、agent-web 测试 + typecheck/build；无 compose/smoke 变更。
