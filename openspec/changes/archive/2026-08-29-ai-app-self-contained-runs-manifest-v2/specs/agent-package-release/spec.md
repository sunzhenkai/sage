# agent-package-release

## MODIFIED Requirements

### Requirement: 源包目录规范与 manifest 契约
系统 SHALL 定义 ai app 源包的目录规范与 manifest 契约：根目录必含 `app.yaml`（package id、version、description、entry prompt 引用、模型路由要求、budgets、skillRefs、capabilityRefs），可选包含 `prompts/*.md`、`references/*.md`、`output.schema.json`；manifest 校验 SHALL 拒绝未知字段与缺失必填字段，目录校验 SHALL 拒绝未声明资产与路径穿越。源包 SHALL NOT 包含可执行脚本、动态 include 或 Secret。

声明 `schemaVersion: '2'` 的 manifest 额外接受三个可选声明块，全部缺省时语义与 v1 逐字节等价：
- `inputs`（≤8 条）：App 级参数定义，每项含唯一 `name`、`type ∈ {string, enum, number}`（enum 须带非空 `enum` 值集）、可选 `default`（须通过类型校验）与 `required`（缺省 false；无 default 且 required 的参数由准入强制提供）。
- `dataSources`（≤8 条）：声明式外部数据依赖，每项含唯一 `name`、`ref`（`capability://` scheme）、`url`（public HTTPS、无凭据/fragment）、可选 `maxBytes`（≤ 512 KiB 平台上限）与 `onFailure ∈ {fail, markMissing}`（缺省 `fail`）。
- `tasks`（≤16 条）：命名执行入口，每项含唯一 `name`、可选 `entry`（缺省继承顶层 entry，指向包内存在的 prompt 资产）、可选 `params`（绑定映射，值只可引用已声明的 `inputs` 名或字面量，缺省继承全部 inputs 默认绑定）与可选 `output`（`schema` 指向包内存在的 schema 资产、`files` 为非空产物名清单）。

编译器 SHALL 将归一化后的声明（含隐式单任务展开）透传进 Release lock 的 manifest 摘要；`capabilityRefs` 保持纯声明语义。校验 SHALL 拒绝：越界清单、重复 name、引用不存在的 entry/schema 资产、params 绑定引用未声明 input、非法 URL、default 类型不符。

#### Scenario: 合法源包通过校验
- **WHEN** 校验器加载一个由 `app.yaml` 与若干 prompts/references/output schema 组成的源包目录
- **THEN** 校验通过并返回结构化的包描述（资产相对路径、digest、manifest 内容）

#### Scenario: manifest 违反契约
- **WHEN** manifest 缺少必填字段、包含未知字段，或字段值越界（如 budgets 为负、entry prompt 不存在）
- **THEN** 校验器返回稳定的结构化错误并列出违规路径，不产生部分结果

#### Scenario: 目录包含未声明或危险资产
- **WHEN** 目录中出现 manifest 未声明的文件、跨出包根的路径引用、可执行脚本或疑似 Secret
- **THEN** 校验器拒绝该源包并返回稳定错误码，不读取资产内容进结果

#### Scenario: v2 声明通过校验并进入 lock
- **WHEN** manifest 声明了有界的 inputs/dataSources/tasks 且引用的 entry/schema 资产均存在
- **THEN** 编译通过，归一化声明（含任务展开）透传进 Release lock 的 manifest 摘要

#### Scenario: 无新字段的 v1 包逐字节等价
- **WHEN** 编译一个不含任何 v2 声明的既有源包
- **THEN** 编译产物（Release、lock、digest）与 v1 行为逐字节一致，隐式单任务展开仅出现在 lock 摘要的规范化表示中且不改变 digest 输入

#### Scenario: v2 声明非法被拒绝
- **WHEN** 清单越界（>8 inputs/dataSources 或 >16 tasks）、name 重复、dataSources URL 非 HTTPS 或含凭据/fragment、maxBytes 超平台上限、tasks 引用不存在的资产、params 绑定引用未声明的 input、default 类型不符
- **THEN** manifest 校验以稳定错误拒绝该源包，列出违规路径，不产生部分结果
