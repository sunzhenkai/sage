# ai-app-self-contained-runs-output-contract — Design

## Context

输出端自闭环子变更；决策级依据 driver `design/app-task-run-model.md` §3.4 与 ADR。现状：worker 原样落盘 `outcome.output`（`activities.ts` `writeRunOutput` 调用点），schema 零校验。

## Goals / Non-Goals

**Goals:** 物化点管线（剥离→解包→校验→files 登记）与违约失败语义；v1 豁免逐字节等价。**Non-Goals:** 前端渲染（F）、流式校验、非 JSON 输出格式的结构化校验（markdown schema 后置）。

## Decisions

- **校验点在 worker 物化前而非准入/commit 后**：输出此时已成文且尚未持久化，违约即不落盘；slice 失败可重试（模型重跑有机会修正）。
- **think 剥离实现**：worker 侧独立实现与 web `splitAssistantText` 同语义的剥离（正则 + 状态机测试钉死），不跨包依赖 agent-web；剥离文本默认丢弃（driver 未决问题 #4 裁决：不另存 reasoning 产物，需要时后续变更再加）。
- **JSON Schema 校验器**：复用 `agent-package-release` 编译侧已有 schema 校验设施（若无独立轻量实现，允许在 worker 内引入与编译侧同一校验库），禁止每 Task 动态拉取远程 schema。
- **失败可重试**：违约是模型行为问题，重跑有修正概率；连续违约由既有 attempt 上限收敛。

## Risks / Trade-offs

- [校验器误杀合法输出] → 仅对声明 schema 的 Task 生效；错误信息附违反路径便于修 prompt/schema；v1 全豁免。 [剥离正则漏网] → 状态机实现 + 用例矩阵（嵌套/未闭合/多段）钉死。
