# Design

## Context

见 proposal.md - Why。实现方案已在 taskrail 流程冻结（`tasks/ongoing/mcp-server/design/mcp-server.md` + ADR + grill 纪要），本 driver 的设计问题只剩一个：如何拆子 change。

## Goals / Non-Goals

**Goals:**
- 给出子 change 拆分与编排顺序，使 apply 阶段只做实施、不改 change 语义。

**Non-Goals:**
- 不重复技术设计（指针见 proposal.md「已采纳方案」）。

## Decisions

**单实现子 change `mcp-server-implement`，不拆多 slice。** 理由：

- 交付面是一个内聚模块（agent-api `src/mcp/`），无跨仓、无跨 planning root；鉴权、registry、invoke、测试互相依赖（registry 测试需要 invoke，集成测试需要全部），拆开会制造 change 间等待而无并行收益。
- 备选（放弃）：按「骨架+鉴权 / tool 映射 / 测试证据」拆三个 slice——同一目录同一模块内的机械分层，slice 间边界是文件级而非能力级，徒增编排开销；tasks.md 内部已按此分层组织任务段，足够。
- 参照：既有 `agent-web-i18n-driver` 同为单 implement 子 change 先例。

## Risks / Trade-offs

- [单子 change 任务数偏多（4 段 13 项）] → tasks.md 每项带独立验证点，apply 可逐项勾选与中断恢复；不构成拆分理由。

## Migration Plan

不适用（driver 只编排；实现侧回滚见子 change design.md）。
