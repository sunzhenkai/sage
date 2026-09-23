## Why

用户已确认 `docs/design/ui/design-language.md` 的类 Notion 安静型效率工具是目标设计方案。当前设计语言、布局契约、旧 frontend prompt、README 和一次性检查报告对视觉权威的表述互相冲突，且 `global.css` 仍是园丁台实现；在实现皮肤前必须先冻结目标 token、明确文档职责，并记录当前到目标的迁移差异。

## What Changes

- 修改 UI 文档权威关系：`design-language.md` 为目标视觉权威，`ui-v1.md` 为功能行为权威，`layout-v1.md` 为结构/交互契约，`global.css` 为运行时 token 与实现事实。
- 建立类 Notion target token 映射与 current / target / delta 迁移清单，冻结中性灰、蓝/琥珀/绿/红语义色、字号、圆角、阴影、图标和动效。
- 收敛 `layout-v1.md` 的结构契约，删除园丁台身份、失效的“动效仅三种”“全站唯一选中类”等断言，并明确 `.pane-item`、`.is-current`、`.is-active`、通知和仅亮色的职责边界。
- 将 `ui-v1-frontend-prompt.md` 标为历史实现 prompt，移除“样式自由 / 明确不设限”的有效指令；保留功能、安全和 `ui-v1` 功能自检内容。
- 收窄 `ui-v1.md` 的非范围表述，保留 status/alert、当前视图可辨识、语言入口、时间格式等功能验收。
- 收窄 `CONTEXT.md` Avoid 的适用范围，增加 API、manifest、领域对象、query 名和视图名例外；同步 README 索引与历史检查报告状态。

## Non-goals

- 不修改 `global.css` 或共享组件、视图样式；皮肤迁移由 `ui-notion-design-system` 和 `ui-notion-design-views` 完成。
- 不改变 `ui-v1.md` 的功能行为、状态机、错误码、API、安全边界或可访问性语义。
- 不因设计样本新建命令面板、看板、keycap 等产品功能。
- 不修改 `taskId`、`runId`、manifest `entry`、query 名或领域字段。

## 涉及面

| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 修改 UI 文档、目标 token 映射、迁移清单和相关索引/状态说明 |

## 验收标准

- [x] `design-language.md` 明确 target visual authority、正式 target token、current/target/delta 和未采用组件边界。
- [x] `layout-v1.md` 只保留结构、交互、功能可观察行为与可验证边界，并指向目标 token 映射。
- [x] `ui-v1-frontend-prompt.md` 自身标明历史/归档，不再以“样式自由 / 明确不设限”作为有效执行指令。
- [x] `ui-v1.md` 的功能语义保持不变，只收窄纯视觉非范围表述。
- [x] `CONTEXT.md` Avoid 具备适用范围和领域/代码例外，README 与 `ui-check.md` 的权威/快照状态一致。
- [x] `openspec validate --strict --type change ui-notion-design-docs` 通过。

## 验证记录

- [x] 文档权威排序、目标 token 引用、历史状态、Avoid 例外和死链处理已检查；产品源码未修改。
- [x] `openspec validate --strict --type change ui-notion-design-docs`：`Change 'ui-notion-design-docs' is valid`
