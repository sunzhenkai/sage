# ai-app-self-contained-runs-input-binding — Design

## Context

吸收 `package-run-input-snapshots` 提案（其 design D1–D7 全部保留：准入期确定性预取而非工具循环、GitHub Search API 数据源、复用 tool-runtime 受控出口、有界与超时）并扩展参数绑定。决策级设计见 driver `design/app-task-run-model.md` §3.2/§3.3 与 `design/phasing-and-migration.md` §3。

## Goals / Non-Goals

**Goals:** params 解析、dataSources 兑现、`input` 字段 410、幂等键覆盖参数与快照内容。**Non-Goals:** 快照缓存/预取调度、需要认证的数据源、UI 表单（F）。

## Decisions

- **相对吸收提案的差异**：`inputSnapshots` → `dataSources`（manifest v2 归一化形，A 提供）；新增 `onFailure: markMissing`（缺省 fail 不变）；幂等 commandKey 从 `(userInput, contentDigest, assetDigests)` 改为 `(task, 解析 params, snapshot digests, contentDigest, assetDigests)`。
- **抓取实现位置**：agent-api 准入进程内（provider-catalog 已有出站 HTTPS 先例；worker 不获得出口能力）；幂等命中既有 Spec 时在抓取前短路（commandKey 先查——注意 commandKey 含快照 digest，故「命中」必然内容一致，不产生陈旧命中）。
- **markMissing 标注格式**：`[snapshot {name} unavailable: {reason}]` 单行段，实现细节不进 spec 正文（driver 未决问题 #2 裁决：保持实现级）。
- **410 而非 400**：语义是「字段已移除」而非「值非法」；错误体附 params/Chat 指引。

## Risks / Trade-offs

- [准入延迟随外网波动] → 每条 10s 超时 + fail 快速失败；markMissing 可声明。 [打破既有调用方] → `input` 410 窗口 + 前端同批切换（F）；README/示例同步。
