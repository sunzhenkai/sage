# package-output-contract Specification

## Purpose
定义 ai app 包运行输出契约的强制行为：Task 声明输出 schema 与文件清单时，物化点执行剥离、校验与登记，输出不合约即任务失败；未声明的 Task 保持既有行为。
## Requirements
### Requirement: 物化点输出处理管线
声明了 `output.schema` 的 Task，worker SHALL 在物化 run 输出前执行处理管线：剥离内联 `<think>…</think>` 段（剥离后正文不得残留推理文本；剥离结果为空则视为无有效输出）；当输出为 JSON 围栏代码块且声明的 schema 顶层为 object 时 SHALL 解包后校验；随后按声明 schema 校验输出实例。剥离与解包 SHALL NOT 改变未声明 schema 的 Task 的既有物化行为。

#### Scenario: think 剥离后正文干净
- **WHEN** 模型输出含成对 `<think>` 推理段，Task 声明了 output.schema
- **THEN** 物化的 task-output 正文不含 think 段内容，校验作用于剥离后的正文

#### Scenario: JSON 围栏解包校验
- **WHEN** 剥离后正文是单一 ```json 围栏块且 schema 顶层为 object
- **THEN** 解包围栏内容按 schema 校验，围栏本身不算违约

### Requirement: 输出契约违约失败
schema 校验失败的 Task，slice SHALL 以稳定错误 `PACKAGE_OUTPUT_CONTRACT_VIOLATION` 失败（可重试），错误信息 SHALL 指明违反的 schema 路径或条目；系统 SHALL NOT 物化不合契约的 task-output，任务终态 SHALL 为 failed。声明的 `output.files` SHALL 在成功物化时登记为产物名清单；未声明 schema 的 Task SHALL 跳过校验与 files 登记，行为与既有路径逐字节等价。

#### Scenario: 输出不符 schema 任务失败
- **WHEN** 剥离解包后的输出实例不满足声明 schema（缺必填字段/类型不符）
- **THEN** slice 以 `PACKAGE_OUTPUT_CONTRACT_VIOLATION` 失败并指明违反点，无 task-output 物化，任务终态 failed

#### Scenario: 成功物化登记文件清单
- **WHEN** 输出通过校验
- **THEN** task-output 按声明 files 名登记进产物清单，取回行为沿用既有 artifact 端点

#### Scenario: 未声明 Task 豁免
- **WHEN** Task 未声明 output.schema（v1 或 v2 未声明）
- **THEN** 物化行为与既有路径逐字节等价（golden 钉死），不引入新的失败面

