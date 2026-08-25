## Context

- 上一变更 `workspace-provider-catalog-ux` 上线了添加 provider 弹窗（models.dev Catalog 两级选择器、adapter 缺省启发、409 重载、降级）。
- models.dev payload 每个模型带 `release_date`（实测 active snapshot 7285/7285 携带该字段；其中 218 个为月份精度 `YYYY-MM`（如 `2026-01`、`2025-04`），其余为 `YYYY-MM-DD`——初版「7292/7292 全覆盖 `YYYY-MM-DD`」的测量假设有误，按日精度严格校验会拒绝真实上游数据），另有 `last_updated`；当前 projection 白名单未暴露，read API 模型排序为 `status rank → normalized name → id`（`service.ts` 的 `key()`），cursor 绑定该 sortKey 全序。
- **缓存现状（回答「从 model.dev 加载的数据会缓存吗」）**：会。浏览器从不直连 models.dev，读的是服务端 PostgreSQL 快照——启动/每 24h±15min 定时同步，失败 5m/30m/2h/6h 退避重试，LKG 兜底；因此新模型最长约 24h 延迟可见。manual sync（`POST /v1/provider-catalog/sync`）已存在：需 `provider-catalog-admin`（本地 runtime principal 显式具备），距最近完成不足 60s 返回 429 + `retryAfterSeconds`，返回 202 `{attemptId, status}` 异步执行。
- 弹窗 adapter 缺省启发在 `selectProvider` 中无条件写入 `adapterKind`，覆盖用户手改值——即用户反馈的「改了又被改回去」。

## Goals / Non-Goals

**Goals:**
- 「最新模型在最前」在任何分页深度都成立（服务端排序，而非前端页内重排）。
- adapter 手改值跨选择器操作稳定；改 adapter 不破坏已选 provider/model。
- 弹窗内一键刷新目录（触发 sync + 从新快照重载）。

**Non-Goals:**
- 不改快照/LKG/ETag/同步调度治理；不加新的 sort 查询参数（只改默认全序）。
- 不在 Providers 页加目录状态行/刷新入口（仅弹窗内；后续可独立迭代）。
- 不为 catalog read 引入 HTTP 层浏览器缓存（快照分页本身稳定，语义上服务端即缓存）。
- 不补齐 localization spec 中历史遗留的 `savedMetadata`/`catalogSyncStatus`/`catalogSyncAttempt` 键（与现有 UI 无对应，属既有 drift，另行处理）。

## Decisions

### D1: 模型「最新在前」改在服务端排序契约，而非前端页内倒序
前端倒序只能重排已加载页：`limit=100` 下模型数超限的 provider（如 openrouter 数百个）最新模型可能尚未加载，倒序失效。故改 read API 默认全序：`status rank → releaseDate 新→旧 → normalized name → id`。备选「前端排序」放弃；备选「新增 sort 参数」放弃（唯一消费方就是要这个默认序，参数化徒增契约面）。
- **projection**：`release_date` 提升为已使用字段——合法 `YYYY-MM-DD` 或月份精度 `YYYY-MM`（bounded、严格格式，原样透传不归一化补日——补 `-01` 会虚构源数据不存在的日精度）→ `releaseDate`；缺失 → 不产生字段（payload 仍接受）；存在但非法 → 整批拒绝（与既有 tolerance 规则一致：已使用字段非法即拒）。
- **desc 实现保持升序比较体系**：`service.ts` 的 sortKey/cursor 逐段 `localeCompare` 升序、cursor 存字符串数组。日期 desc 用 9-补映射（`'2026-04-14'` 每个数字字符 `d → '9'-d`，`-` 不变）——映射后字典序升序恰为日期降序，纯字符串、不改 `compareKeys`/cursor 结构。缺失日期映射为同形态最大补 `'9999-99-99'` 排同 rank 内最后（实测默认 locale 的 `localeCompare` 会把 `':'` 等标点排在数字前，非同形态哨兵会错序，故不可用）。月份精度 `YYYY-MM` 的 key 是同月日精度 key 的前缀，同月内排最前（视为该月最新），跨月序不受影响。
- **旧 cursor 边缘**：排序规则变更瞬间，同快照内旧分页 cursor 的 sortKey 语义错位（可能跳/重个别条目）。弹窗每次打开从第一页开始且 409 快照变化兜底，接受此一次性边缘，不改 cursor 编码。

### D2: adapterDirty 与 nameDirty 同型
`WorkspaceProviderDialog` 增加 `adapterDirty` ref：adapter select 的 onChange 置 true；`selectProvider` 仅在 `!adapterDirty.current` 时应用缺省启发；编辑既有条目时初始化为 true（不覆盖存量 adapter）。改 adapter 不触碰 provider/model 选择状态（现状已不清，补测试断言）。这消除「改 adapter → 再选 provider/model → adapter 被改回」的往返。

### D3: 刷新目录 = manual sync + attempt 轮询 + 重载
弹窗目录区标题行放次级小按钮「刷新目录」：
1. `POST /v1/provider-catalog/sync`（空 body）→ 202 `{attemptId}`。
2. 轮询 `GET /v1/provider-catalog/sync/:attemptId`（1s 间隔、至多 10 次）至终态 `succeeded`/`not_modified`/`failed`/`cancelled`。
3. 终态后 bump provider/model reload token 从最新快照重载第一页（复用 409 重载路径）；`not_modified` 也重载（幂等、成本低）。
4. 429 → 提示限流（带服务端 `retryAfterSeconds` 若有）；403 → 提示无手动同步权限；网络/5xx → 提示失败。均不自动重试、不阻塞手工录入。
5. 进行中按钮禁用并显示同步中文案；超时（10s 未到终态）按失败提示但不再轮询。

## Risks / Trade-offs

- [排序契约变更影响所有 read 消费方 → 当前唯一消费方是弹窗，且新序即其目标行为；在 proposal/spec 中显式声明]。
- [release_date 未来格式漂移（如带时间部分、年精度）→ 严格双精度（`YYYY-MM-DD`/`YYYY-MM`）校验，非法整批拒绝沿用既有「整批拒绝旧 active 保持」路径，快照不损坏]。
- [manual sync 60s 限流让「刷新」偶发 429 → 提示带 retryAfterSeconds，用户稍后重试；不绕过限流]。
- [9-补映射可读性略低 → 实现处一行注释说明映射不变式（补映射后字典序 = 原日期降序）]。
- [排序变更瞬间的旧 cursor 错位（见 D1）→ 接受为一次性边缘，409/快照绑定兜底]。

## Migration Plan

服务端与前端可同版本发布（排序与字段向后兼容：`releaseDate` optional、默认排序变化即目标行为）；回滚即回退构建，快照数据无需迁移（`releaseDate` 由既有 raw snapshot 重建 projection 派生）。
