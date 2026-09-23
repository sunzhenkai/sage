## 1. 目标权威与 token 冻结

- [x] 1.1 更新 `design-language.md`：状态改为 target visual authority，补充目标 token 入口、目标/当前/差异入口和未采用组件边界，明确近似值不作为实现取值。
- [x] 1.2 对照 `target-token-map.md` 与 `design-language.md`，确认中性灰、语义状态色、字号、圆角、阴影、图标、动效目标值逐项一致，并记录任何需保留的来源说明。

## 2. 文档职责与历史清理

- [x] 2.1 更新 `layout-v1.md`：保留结构、交互和功能可观察行为，删除园丁台主题身份、失效动效清单、错误的全站唯一选中类和不可达 openspec 引用，加入目标 token 权威规则。
- [x] 2.2 更新 `ui-v1-frontend-prompt.md`：文件自身标注 historical / archived，改写“样式自由 / 明确不设限”和样式/结构自行决定条款，保留功能、安全和 `ui-v1` 功能自检。
- [x] 2.3 收窄 `ui-v1.md` 非范围表述：不规定纯视觉形态，但保留 status/alert、当前视图可辨识、语言入口、时间格式等功能验收；同步 README 索引。
- [x] 2.4 收窄 `CONTEXT.md` Avoid 适用范围并增加 API/manifest/query/领域对象例外；更新 `ui-check.md` 文首为一次性快照，并记录已知过期项。

## 3. 验证与收口

- [x] 3.1 检查文档权威排序、目标 token 引用、历史状态、Avoid 例外和死链处理，确认不改产品源码。
- [x] 3.2 运行 `openspec validate --strict --type change ui-notion-design-docs`，将结果写入 proposal 验证记录。
