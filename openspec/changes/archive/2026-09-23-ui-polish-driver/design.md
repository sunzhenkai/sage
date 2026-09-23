## Context

报告 `tasks/20260923-ui-audit/ui-check.md`（基线 725ad1f）共 16 项：P1×11 + P2×5，全部落在 `platform/apps/agent-web/src`。按问题域拆成 3 个子 change，命名 `ui-polish-<slice>`，与本 driver 同一 planning root。

## Goals / Non-Goals

**Goals:**
- 三个子 change 合计完整覆盖报告全部 16 项，无遗漏、无重复归属
- 每个子 change 独立可实施、可验证、可 validate

**Non-Goals:**
- driver 与子 change 均不做 spec 增量（`skip_specs: true`）
- 不改后端、不加新功能（见 proposal Non-goals）

## Decisions

- **拆分为 3 个子 change**（报告编号归属）：
  1. `ui-polish-packages-list`：P1#1（应用列表栏溢出）+ P2#16（应用详情表头英文）——同在 PackagesView 渲染路径，一起改避免二次回归
  2. `ui-polish-terminology`：P1#6~#11（available 写死、AI Apps、conversation/chat、默认模型、单独 Run、Declared Task/entry）——全部是 `CONTEXT.md` 用语契约违规，集中在 i18n 词条与少量视图文案
  3. `ui-polish-a11y-interaction`：P1#2~#5（导航可访问名称、删除确认撑破、live region、combobox activedescendant）+ P2#12~#15（标题行换行、搜索框 aria-label、按钮 aria-busy、日志空态）——交互与辅助技术支持
- 替代方案（按报告原建议 4 片把 P2#12 单列）被合并进 a11y 片：#12 是纯 CSS `flex-wrap`，与 #2/#3 同属窄宽度交互修复，单列不产生额外依赖收益
- 三个子 change 相互独立，无先后依赖；实施顺序建议 packages-list → terminology → a11y-interaction（前两者改动面小、先收口）

## Risks / Trade-offs

- [报告行号基于 725ad1f，实施时分支可能前移] → 实施时以问题描述与选择器/词条 key 重新定位，不盲用行号
- [terminology 与 a11y 片都触碰 ChatView] → terminology 只改文案词条，a11y 片只改结构与 CSS，改动不相交；仍建议按上述顺序串行实施

## Open Questions

无。
