## Context

`agent-web` 当前源码包含共享 `global.css`、六个视图 CSS/TSX 和反馈/通用组件；当前静态基线通过，但尚无当前截图证据、当前 Cursor Grok 4.7 报告或 P0/P1 处置记录。历史 `ui-check.md` 至少三条结论已漂移，不能直接作为修复清单。本子 change 依赖 `ui-detail-polish-evidence` 先提供当前截图、运行时断言和证据状态。

动机与验收边界见 `proposal.md`；本文件只决定 view slice 的修复组织方式。

## Goals / Non-Goals

**Goals:**

- 修复当前审查确认的 P0/P1 视图、组件、ARIA、窄宽度和呈现层细节问题。
- 保持三段式、五视图、查询参数选中、`.pane-item`/`.is-current`/`.is-active`、status/alert、仅亮色和领域/API 语义。
- 对每个 finding 保留 source、evidence、fix 或 acceptance reason，形成可复核的处置表。
- 在修复后用静态回归和浏览器截图/断言证明没有新回归。

**Non-Goals:**

- 不改 `ui-v1.md` 功能契约、状态机、API、错误码、安全边界或领域对象。
- 不修改文档权威、README、CONTEXT 或历史报告；这些归 `ui-detail-polish-docs`。
- 不改截图工具、Playwright 配置或证据清单；这些归 `ui-detail-polish-evidence`。
- 不新增业务页面、路由、第三方 UI 框架、暗色主题或新功能。
- 不执行提交、推送、归档、打 tag、部署或其他线上动作。

## Decisions

1. **以当前报告和当前证据为唯一 finding 来源。** 报告必须引用当前 SHA、截图清单和运行时断言；历史报告只用于发现“可能需要复核”的线索，不能直接勾选完成。
2. **按问题域而不是历史编号组织修复。** 可能的子任务按共享 shell/ARIA、列表/窄宽度、表单/反馈、详情/状态和视图局部表面划分；同一文件的修复串行执行，避免互相覆盖。
3. **先修行为语义，再修视觉细节。** 可访问名称、live region、选中、焦点、溢出和状态可辨识性优先于装饰性间距；所有修复必须保留功能契约。
4. **修复与证据成对验证。** 每个 P0/P1 先记录 source/evidence，再改代码，再运行当前截图、DOM 断言和静态回归；接受项必须写当前理由和风险，不以历史结论代替。
5. **共享 CSS 与视图 CSS 分层。** 共享 token、通用组件状态和 shell 规则集中在 `global.css`/`components`；视图只改局部布局、密度和表面，避免重新引入未映射 token。
6. **P2 不扩张范围。** 当前报告 P2 若不阻塞主路径或已有明确债务，只记录状态、后续建议和不修理由；不得借 P2 重写 type scale、Avoid 词表或整套设计系统。

## Risks / Trade-offs

- [当前审查可能没有 P0/P1] → 报告明确写“零 finding”并由 view 子 change 记录核验，不为凑任务伪造缺陷。
- [共享 CSS 修复可能影响多个视图] → 每个修复绑定截图/DOM 证据，按 shell → view 顺序验证；失败回滚对应最小范围。
- [修复后截图受 fixture 波动影响] → 使用 evidence 子 change 固定的 URL、locale、viewport、fixture 和状态等待条件。
- [历史报告的旧行号误导定位] → 只按当前 selector/class/component 重新定位；报告必须标 current/revalidated。
- [视觉修复误伤功能] → 每轮先跑 `check:ui-tokens`、`typecheck`、`build`，再跑浏览器断言；功能契约保持只读。
- [接受 P0/P1 会产生风险] → 只有当前证据证明不可复现、属于产品刻意取舍或修复会破坏功能时才接受，理由写入 proposal。

## Migration Plan

1. 等待 evidence 子 change 提供当前截图清单、运行时断言和基线 SHA。
2. 执行 Cursor Grok 4.7 只读审查，按 view/docs/evidence 归类 finding；view 子 change 只接收 P0/P1 和需记录的 P2。
3. 先修共享 shell/ARIA/反馈，再修列表/窄宽度，再修详情/表单/局部状态；每组修复更新处置表。
4. 每组完成后重跑当前截图、DOM 断言、token/type/build 回归。
5. 将 source、evidence、fix/acceptance、P2 状态和命令结果回填本子 change proposal/tasks。
6. 不提交、不归档、不推送；最终状态由 driver 收口。

## Open Questions

无。发现集由当前 Cursor 报告决定；若报告为零 finding，view 子 change 仍需完成核验并记录零 finding，不改变拆分。
