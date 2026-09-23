## Context

当前 `docs/design/ui` 已有 `ui-v1.md`、`layout-v1.md`、`design-language.md`、`target-token-map.md` 和历史 prompt；`CONTEXT.md`、README 与历史审计报告也参与文档权威关系。历史约束评审要求把功能、结构、目标视觉、运行时 token、历史参考和一次性 findings 分层，但该评审基于旧检出，不能直接当作当前修改清单。当前还没有 Cursor Grok 4.7 报告或 docs finding 处置记录。

动机与验收边界见 `proposal.md`；本文件只决定 docs slice 的核对与修订方法。

## Goals / Non-Goals

**Goals:**

- 以当前审查和当前文档内容为准，修正文档状态、权威边界、引用、Avoid 范围和历史报告状态。
- 确保 README、`layout-v1.md`、`design-language.md`、`target-token-map.md`、`ui-v1-frontend-prompt.md`、`CONTEXT.md` 和 `docs/design/README.md` 各自只承担已声明职责。
- 保留 `ui-v1.md` 的功能语义、状态机、API、错误码、安全边界和可访问性行为。
- 对每个 docs P0/P1 形成 source/evidence/fix/acceptance 记录，对 P2 形成状态记录。

**Non-Goals:**

- 不改 `platform/apps/agent-web/src` 产品源码、视觉 token 值、路由或 API。
- 不改截图/Playwright/证据工具；这些归 `ui-detail-polish-evidence`。
- 不处理 view P0/P1；这些归 `ui-detail-polish-view`。
- 不重写整套设计系统、type scale、Avoid 词表或功能规格。
- 不执行提交、推送、归档、打 tag、部署或其他线上动作。

## Decisions

1. **当前报告是 docs finding 来源。** 每条 finding 记录当前 SHA、输入文件、证据路径、修复状态和理由；历史约束评审只作为线索，过期项标 rejected/revalidated。
2. **权威分层固定为五类。** `ui-v1.md` 管功能行为；`layout-v1.md` 管结构/交互/可观察呈现；`design-language.md` 管目标视觉意图；`target-token-map.md` 管冻结映射；`global.css :root` 管运行时值。README、CONTEXT、prompt 和历史报告只做索引/范围/状态说明。
3. **Avoid 只管用户可见称呼。** `CONTEXT.md` 明确不约束代码标识、API 路径、query、manifest、规格字段和领域对象，并记录 Chat/Task/Chat Run/entry/默认运行模型等例外；不据此改源码标识。
4. **历史内容降级而不删除。** prompt、旧报告和参考设计保留可追溯性，但通过状态、链接和禁用语句阻止其成为验收依据；不把历史报告的旧行号回灌当前实现。
5. **文档修订与回归成对验证。** 每条 docs 修复后检查链接、状态、引用、Avoid 边界和功能契约 grep；再运行 token/type/build，避免文档修订触碰产品语义。
6. **P2 不扩张范围。** 当前 P2 只有在影响权威可判定性、可追溯性或索引可达性时才修；纯措辞、已知债务和无法验证的口号记录 deferred/rejected 理由。

## Risks / Trade-offs

- [当前审查可能没有 docs P0/P1] → 报告写明零 finding，docs 子 change 仍完成核验并记录零 finding，不伪造修订。
- [修改文档状态可能改变验收解释] → 每处状态改写附来源和权威规则，`ui-v1.md` 功能条款保持只读。
- [历史报告和当前文档存在删除/引用状态差异] → 只处理当前审查确认的引用；删除记录、归档状态和死链分别记录，不擅自恢复或重写历史。
- [Avoid 例外过宽或过窄] → 以当前用户可见文案和规格字段分别判定，代码/API/manifest/领域对象明确排除。
- [README/索引修订遗漏入口] → 用静态链接检查和文档职责 grep 逐项核验。
- [文档修订后仍被旧 prompt 误导] → prompt 头部和历史说明同时标明 archived/disabled，验收引用只指向当前权威。

## Migration Plan

1. 等待当前 Cursor Grok 4.7 报告和 evidence 基线，提取 docs P0/P1/P2。
2. 逐条定位当前文档 source，建立处置表；历史报告漂移项标 revalidated/rejected。
3. 先修权威边界和状态，再修 Avoid 范围/例外，再修 README/索引/死链/历史引用。
4. 每组修订运行链接、状态、引用、功能契约 grep 和 token/type/build 回归。
5. 将 source/evidence/fix/acceptance/P2 状态写入本子 change proposal/tasks。
6. 不提交、不归档、不推送；最终状态由 driver 收口。

## Open Questions

无。当前 docs finding 集由审查报告决定；若为零 finding，docs 子 change 仍执行当前权威核验并记录零 finding，不改变范围。
