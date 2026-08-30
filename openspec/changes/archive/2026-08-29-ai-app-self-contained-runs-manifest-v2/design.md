# ai-app-self-contained-runs-manifest-v2 — Design

## Context

契约基座子变更；决策级设计与目标契约全文见 driver `design/app-task-run-model.md` §3.1 与 `design/adr-task-as-declared-entry.md`。本文件只记录本子变更的实现级决策。

## Goals / Non-Goals

**Goals:** manifest v2 三声明块（inputs/dataSources/tasks）的 schema、归一化与编译透传；v1 逐字节等价。**Non-Goals:** 任何运行时行为（准入解析在 B、输出校验在 C）、参数系统 v2 扩展（array/object，见 driver 未决问题）。

## Decisions

- **归一化单点**：`compiler.ts` 内一个纯函数把（可能无声明的）manifest 归一化为「总是含 tasks 数组」的内部形（隐式单任务展开），运行时（B/C）只消费归一化形，不重复实现缺省分支——双语义漂移面收敛到一处。
- **digest 兼容**：v1 包的归一化展开只出现在 lock 摘要的规范化 JSON 表示；v1 golden 用「编译产物 Release 序列化 + lock 摘要」逐字节比对（本变更接受 lock 摘要含规范化新增键，Release 主体与 contentDigest 不变）。
- **params 绑定语法**：值只允许 `${inputs.<name>}` 引用或与 input 类型相符的字面量；不引入表达式。
- **bounds**：inputs/dataSources ≤8、tasks ≤16、maxBytes ≤512 KiB、files ≤8——对齐 driver 设计 §3.1 与安全上限。

## Risks / Trade-offs

- [隐式展开污染 v1 lock 摘要] → golden 断言 Release 主体与 digest 不变，摘要新增键显式列出并测试钉死。
