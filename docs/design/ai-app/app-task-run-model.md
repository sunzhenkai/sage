# App / Task / Run 自闭环模型 — 主设计

> 暂存于 driver design/，归档落点 `docs/design/ai-app/app-task-run-model.md`。决策依据见同目录 ADR。

## 1. 北极星

App（Release）是自闭环定义：**输入**（声明式数据依赖 + 参数及默认值）、**处理**（Task 入口 + prompt/references + 模型路由）、**输出**（schema + 必须文件清单 + 失败语义）全部在契约内。Run 创建即闭环：参数物化、数据快照落账、之后 retry/重放/调度复用同一输入。人工自由文本只属于 Chat，经 promotion 一次性固化。

## 2. 三层模型与职责

```
┌─────────────────────── 定义层（不可变） ───────────────────────┐
│ App Package (source)                  compile → Release.v2 (lock)│
│  app.yaml: inputs / dataSources /     manifest 摘要含全部声明，  │
│    tasks / modelRoute / budgets       digest 覆盖、审计可重建    │
│  prompts/ references/ output/(schema, template)                 │
└────────────────────────────┬───────────────────────────────────┘
                             │ 准入（per Task）
┌────────────────────────────▼───────────────────────────────────┐
│ Run（实例，创建即闭环）                                          │
│  1 解析 params：按 inputs 声明校验，缺省取默认值                 │
│  2 解析 dataSources：受控出口抓取（onFailure: fail|markMissing） │
│  3 组装输入：entry + references + snapshot 段 + params 段        │
│  4 inputDigest = f(release, task, params 值, snapshot 内容)      │
│  5 AgentTaskSpec / Envelope（权威矩阵不变）→ durable workflow    │
└────────────────────────────┬───────────────────────────────────┘
                             │ 执行（单轮 harness 不变）
┌────────────────────────────▼───────────────────────────────────┐
│ 输出闭环：模型文本 → 剥离 think 段 → 按 task.output.schema 校验  │
│  → 按 files 声明物化 artifacts → 契约不符 = 任务失败（可行动错误）│
└─────────────────────────────────────────────────────────────────┘
触发面（三种，殊途同归进 Run）：
  · 人工：UI/API 提交 params（表单由声明渲染）
  · Chat promotion：提升瞬间物化消息为 Run 输入（既有模式，确认不变）
  · Schedule（P8 修订）：绑定 releaseRef + task + 固化 params + releasePolicy(pinned|follow)
```

## 3. 目标契约

### 3.1 manifest v2（`app.yaml`，全量新增字段均可选，缺省 = v1 等价）

```yaml
schemaVersion: '2'
id: github-trending
version: 2.0.0
description: GitHub 热门项目解读
modelRoute: { provider: ..., model: ..., fallbacks: [...] }   # Phase E 起参与执行解析
inputs:                          # App 级参数定义（v1：string/enum/number + 默认值）
  - { name: window, type: enum, enum: [1, 7, 30], default: 7 }
  - { name: language, type: string, default: "", required: false }
dataSources:                     # 声明式数据依赖（吸收 package-run-input-snapshots）
  - name: github-trending-weekly
    ref: capability://web-snapshot-reader/v1
    url: https://api.github.com/search/repositories?...        # public HTTPS，无凭据
    maxBytes: 524288             # ≤ 平台上限
    onFailure: fail              # 缺省 fail；可声明 markMissing
tasks:                           # 命名入口；缺省 = 隐式单任务（entry 即任务）
  trending-digest:
    entry: prompts/system.md     # 缺省继承顶层 entry
    params: { window: '${inputs.window}' }   # 绑定 App inputs，可覆写默认
    output:
      schema: output/report.schema.json      # 缺省继承 output.schema.json
      files: [report.md]                     # 成功必须物化的产物名
entry: prompts/system.md         # v1 字段保留（隐式任务用）
budgets / skillRefs / capabilityRefs: 不变
```

校验规则：未知字段拒绝（`additionalProperties: false` 延续）；inputs/dataSources 各 ≤8 条；dataSources URL 必须 public HTTPS、无凭据/fragment、name 唯一；tasks 条目 name 唯一、引用的 entry/schema 资产必须存在；params 绑定只能引用已声明的 inputs。

### 3.2 运行入口（`POST /v1/releases/:releaseId/runs`）

```
请求：  { task?: string, params?: { [name]: string|number }, taskId?: string }
        # v1 兼容：task 缺省 = 唯一/隐式任务；params 未声明于 inputs → 400
        # 旧 input 字段：Phase B 起 410 + 指引（deprecation 窗口），Phase C 移除
响应：  PackageRunResult.v1（不变）+ task 字段回显
幂等：  commandKey = f(releaseDigest, task, params 解析值, snapshot digests)
```

### 3.3 组装输入（`assemblePackageInput` 扩展）

拼装次序：entry prompt → `--- references ---` → `--- snapshot: {name} ---`（markMissing 时输出 `[snapshot {name} unavailable: {reason}]`）→ `--- params ---`（名=值逐行）→ `--- user input ---`（仅 Chat promotion 物化来源，包运行不再有）。digest 覆盖全部段内容与来源 URL。

### 3.4 输出契约（物化点强制）

worker `writeRunOutput` 前：剥离 `<think>…</think>`（移入独立 reasoning 产物或丢弃，默认剥离不落正文）→ JSON 提取（输出被 ```json 围栏包裹时解包）→ 按 `task.output.schema` 校验 → 按 `files` 声明登记产物名。任一步失败：slice 以稳定错误码 `PACKAGE_OUTPUT_CONTRACT_VIOLATION` 失败（可重试），错误信息指明违反点。无 schema 声明的 Task：跳过校验（v1 等价）。

### 3.5 调度绑定（P8 修订，Phase D）

`POST /v1/schedules`：`{ releaseRef, task, params, releasePolicy: pinned | follow, cron/timezone/overlap... }`。occurrence 触发 = 以固化 params 走 3.2 同一准入路径（schedule 触发器的输入来源由本模型消解）。schedule 引用的 task/params 在创建时按当时 Release 校验；`follow` 策略下新 Release 不含同名 task 或 inputs 不兼容时，该次触发稳定失败并告警（不静默跳过）。

## 4. 状态与失败模式

Run 状态机不变（running/paused/succeeded/failed/cancelled + EFFECT_UNKNOWN 裁决）。新增失败分类（均稳定错误码、无部分副作用残留）：

| 失败点 | 错误码 | 语义 |
|---|---|---|
| params 未声明/类型不符/缺必填 | `PACKAGE_PARAMS_INVALID` (400) | 准入前拒绝 |
| dataSource 抓取失败且 onFailure=fail | `PACKAGE_SNAPSHOT_SOURCE_UNAVAILABLE` (502, retryable) | 准入拒绝，无任务副作用 |
| dataSource 失败且 markMissing | —（不失败） | 注入缺失标注段，继续运行 |
| 输出不符 schema/files | `PACKAGE_OUTPUT_CONTRACT_VIOLATION` (slice 失败) | 任务 failed，可重试 |
| follow 策略下 Release 不含 task | 触发失败（P8 告警面） | 不静默跳过 |

## 5. 与既有权威的关系（不动清单）

`AgentTaskSpec` / Envelope / Effect & Consumption Ledger / durable coordinator / 单轮 LiveProviderHarness / 受控出口治理（tool-runtime）/ Release 不可变与审计链——全部不变。本重构只动「定义的形状」「准入的输入解析」「输出的判定」，不动执行与治理内核。Chat 链路（会话、事件流、恢复）不变；promotion 语义确认不动。
