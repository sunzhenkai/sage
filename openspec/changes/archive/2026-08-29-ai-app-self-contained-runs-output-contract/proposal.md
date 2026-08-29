# ai-app-self-contained-runs-output-contract

## Why

Run「创建即闭环」的输出端（driver 设计 §3.4 / ADR）：`output.schema.json` 现状纯声明、运行时零校验，任务成败无法依据输出契约判定（用户实际遭遇：任务 succeeded 但输出无法判定、`<think>` 推理块混入正文）。自闭环 App 的输出必须是可判定的。

## What Changes

- 物化点（worker `writeRunOutput` 前）输出处理管线：剥离 `<think>…</think>`（默认不落入正文，reasoning 是否独立保留为实现裁决）、JSON 围栏解包（输出为 ```json 围栏且 Task 声明 object 型 schema 时解包校验）。
- 按 Task 归一化声明的 `output.schema` 校验输出实例；不符 → slice 以稳定错误 `PACKAGE_OUTPUT_CONTRACT_VIOLATION` 失败（可重试），错误信息指明违反点；任务终态 failed，不物化不合契约的 task-output。
- 按 `output.files` 声明登记产物名（声明的文件名映射到物化产物清单）。
- 无输出声明（v1 / 未声明 schema 的 Task）跳过校验与 files 登记——v1 行为逐字节等价。

## Capabilities

### New Capabilities
- `package-output-contract`: 包运行输出契约强制——物化点 think 剥离、schema 校验、files 登记、违约失败语义与 v1 豁免。

### Modified Capabilities

（无——`package-run-live-provider` 的输出持久化需求由新能力增补，不改其原文）

## Impact

- `apps/agent-worker`：`activities.ts` 物化前校验钩子、think 剥离工具（与 web 端 `splitAssistantText` 语义一致的独立实现）、错误映射。
- `packages/task-store-postgres`：`writeRunOutput` 不变（校验在前）；产物登记沿用既有 artifact reference 机制。
- 校验器依赖：JSON Schema 校验复用 `agent-package-release` 编译侧已有校验设施或引入轻量校验（design 裁决）。
