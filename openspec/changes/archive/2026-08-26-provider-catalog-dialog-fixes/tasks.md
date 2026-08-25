## 1. 后端：releaseDate projection 与模型倒序排序

- [x] 1.1 `provider-catalog/src/projection.ts`：`release_date` 校验（bounded `YYYY-MM-DD`；缺失不产生字段；非法整批拒绝）并输出 `releaseDate`；补 `projection.test.ts` 用例（合法/缺失/非法三类）
- [x] 1.2 `app-contracts`：`ModelCatalogItemSchema` 增加 optional `releaseDate`（bounded 日期字符串）；同步受影响的类型/测试
- [x] 1.3 `provider-catalog/src/service.ts`：模型 sortKey 改为 `statusRank → 9-补映射日期 → normalized name → id`（缺失日期哨兵 `':'` 排同 rank 最后）；更新/新增 `service.test.ts` 分页用例（新到旧、缺失排后、cursor 全序稳定、跨页单调）

## 2. 前端：adapter 不覆盖与模型顺序呈现

- [x] 2.1 `workspace-providers.tsx`：新增 `adapterDirty` ref——adapter select onChange 置 true；`selectProvider` 仅在未手改时应用缺省启发；编辑模式初始化为 true；断言改 adapter 不清 provider/model（补测试）

## 3. 前端：目录手动刷新

- [x] 3.1 弹窗目录区标题行增加「刷新目录」按钮：`POST /v1/provider-catalog/sync` → 轮询 `GET /v1/provider-catalog/sync/:attemptId`（1s×10 至终态）→ bump reload token 重载列表第一页（含 `not_modified`）
- [x] 3.2 429（含 `retryAfterSeconds`）/403/请求失败/轮询超时分别以稳定文案提示；进行中禁用按钮；不自动重试、不影响手工录入路径

## 4. 文案与测试

- [x] 4.1 `locale.tsx` 新增目录刷新相关键（刷新目录、同步中、已重载、限流、无权限、失败；zh-CN/en 键集一致），全部经 `t(key, values)` 呈现
- [x] 4.2 `providers.test.tsx` 新增用例：adapter 手改跨选择保持且不清 provider/model；模型列表按 API 返回顺序（新到旧）呈现；刷新成功流程（sync 202 → attempt succeeded → 列表重载）；429 提示
- [x] 4.3 运行 `provider-catalog` 包测试、`app-contracts` 测试、agent-web 全量测试 + typecheck/build；可选本地冒烟弹窗刷新与模型顺序

## 5. 验证收尾

- [x] 5.1 `openspec validate provider-catalog-dialog-fixes --strict` 通过；人工核对三个反馈点（倒序、adapter 不覆盖、刷新）在 spec/design/tasks 中均有对应条目
