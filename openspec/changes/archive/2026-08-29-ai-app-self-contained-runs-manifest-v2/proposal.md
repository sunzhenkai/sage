# ai-app-self-contained-runs-manifest-v2

## Why

自闭环重构的契约基座（driver 设计 `design/app-task-run-model.md` §3.1 / ADR「Task 是声明入口」）：现行 manifest 无法表达 App 的参数、外部数据依赖与多任务入口，运行语义被迫依赖任务级自由文本输入，且调度（P8）无从选择执行入口。契约不先行，输入绑定（B）、调度绑定（D）、示例重造（F）均无依据。

## What Changes

- manifest 新增可选 `schemaVersion: '2'` 与三个可选声明块：`inputs`（App 级参数：name/type/enum/default/required）、`dataSources`（声明式数据依赖：name/ref/url/maxBytes/onFailure）、`tasks`（命名入口：entry/params 绑定/output.schema/output.files）。
- 全部新增字段可选且缺省等价 v1：无 `tasks` 声明的 manifest 归一化为隐式单任务（顶层 entry、无参数、无数据源、输出不强制）。
- strict 校验：`additionalProperties: false` 延续；`inputs`/`dataSources` 各 ≤8 条、`tasks` ≤16 条；`dataSources` URL 须 public HTTPS、无凭据/fragment、name 唯一、`maxBytes` ≤ 平台上限（512 KiB）；`tasks` 条目 name 唯一、引用的 entry/schema 资产必须存在；`params` 绑定只可引用已声明的 `inputs`；`onFailure ∈ {fail, markMissing}` 缺省 `fail`。
- 编译器将归一化后的声明透传进 Release lock 的 manifest 摘要；`capabilityRefs` 纯声明语义不变。
- v1 golden：无任何新字段的源包编译产物与准入行为逐字节等价（本变更只动契约与编译，不动运行时）。

## Capabilities

### New Capabilities

（无——契约扩展归入既有能力）

### Modified Capabilities
- `agent-package-release`: 「源包目录规范与 manifest 契约」需求扩展为 v2：inputs/dataSources/tasks/output 绑定的声明契约、界限与校验拒绝语义。

## Impact

- `packages/agent-package-release`：`source-manifest.ts`（schema）、`source-loader.ts`（资产引用校验）、`compiler.ts`（归一化与透传）、`index.ts` 导出类型。
- 测试：manifest 契约单测（合法/非法矩阵）、编译 smoke、v1 golden。
- 不动：运行时（admission/worker/web）、既有 Release（不可变，无需重编译）。
