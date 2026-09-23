## Context

`design-language.md` 是用户确认的类 Notion 目标视觉方案，但当前仍标为 reference；`target-token-map.md` 已冻结目标 token 与迁移账本。`layout-v1.md` 仍把园丁台视觉、旧动效和选中类写成 active 规则；`ui-v1-frontend-prompt.md` 仍含样式自由条款；README、`ui-v1.md`、`CONTEXT.md` 和历史报告的职责边界也需要收敛。本 change 只改文档和规划说明，不改实现代码。

## Goals / Non-Goals

**Goals:**

- 把功能契约、目标视觉、结构契约、运行时 token、历史 prompt 和一次性 findings 的职责写清。
- 保留 `ui-v1.md` 功能语义、状态机、错误码、API、安全边界和可访问性行为。
- 让 `design-language.md`、`target-token-map.md`、`layout-v1.md`、`global.css` 的冲突规则可判定。
- 将 `CONTEXT.md` Avoid 限制在用户可见称呼，并为 Chat、Task、Run、entry、默认模型等真实对象提供例外。
- 将历史检查报告标为快照，避免旧行号成为长期约束。

**Non-Goals:**

- 不改 `global.css`、共享组件或视图样式。
- 不改变业务功能、API、领域字段或路由。
- 不新增命令面板、看板、keycap 等目标设计样本功能。
- 不把整份 `design-language.md` 重写成另一份实现 token 手册。

## Decisions

1. `ui-v1.md` 是功能行为唯一权威；`design-language.md` 是目标视觉唯一权威；`layout-v1.md` 是结构/交互契约；`global.css` 是运行时事实和目标 token 落点。
2. 目标 token 精确值以 `target-token-map.md` 为准，文档中的近似参考值只解释设计意图，不作为实现取值。
3. 旧 frontend prompt 保留历史和功能纪律，但文件自身标注 historical / archived，并将 §3 末条、§4、§8 的样式自由条款改为失效提示。
4. `layout-v1.md` 只保留三段式、列表职责、`.pane-item` 列表选中、`.is-active` 交互语义、通知 status/alert、仅亮色和功能可观察行为；删除园丁台主题身份、错误动效清单和全站唯一选中类。
5. `CONTEXT.md` 的 Avoid 只约束用户可见称呼；代码标识、API 字段、manifest 字段、query 名和领域对象不适用。
6. `ui-check.md` 文首标注一次性快照和非契约，逐条保留其证据但不作为后续验收标准。
7. 所有权威冲突都指向 `target-token-map.md` 的 current/target/delta，不允许在实现阶段凭视觉偏好重新决定目标身份。

## Risks / Trade-offs

- [文档口径收敛后仍有读者按旧 prompt 复制样式自由] → 在 prompt 文件自身、README 和 layout 历史说明同时写明失效状态。
- [把功能契约中的可观察 UI 误删] → 只收窄“纯视觉非范围”，保留 status/alert、语言入口、时间格式和当前视图可辨识。
- [Avoid 例外过宽导致术语漂移] → 只对领域/代码对象提供明确例外，用户可见标签仍按词表评审。
- [目标 token 近似值被误当最终值] → `target-token-map.md` 明确冻结值和唯一来源，近似值只保留为来源说明。
- [历史报告删除会丢失证据] → 保留报告，在文首标注快照状态和未复核范围。

## Migration Plan

1. 更新 `design-language.md` 状态、权威边界、目标 token 入口、未采用组件边界和历史参考说明。
2. 更新 `layout-v1.md` 的状态、权威规则、列表选中职责、通知/动效边界、目标 token 引用和不可达 openspec 说明。
3. 更新 `ui-v1-frontend-prompt.md` 的历史状态、失效样式条款和目标设计引用。
4. 更新 `ui-v1.md` 的非范围边界，同步 `CONTEXT.md` 的 Avoid 适用范围/例外、README 索引和 `ui-check.md` 快照状态。
5. 校验文档引用、术语例外、目标 token 引用和权威排序，不改产品源码。
6. 回滚只回滚文档变化，不触碰功能契约或实现代码。

## Open Questions

- 无。目标 token 已由 `target-token-map.md` 冻结；旧 prompt 的历史保留范围已按本 change 的目标确定。
