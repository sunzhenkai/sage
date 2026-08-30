# package-output-contract 变更增量

## REMOVED Requirements

### Requirement: 物化点输出处理管线

**Reason**：校验对象与产物形态都定义错了。该需求把模型描述性正文当作 JSON 载体执行剥离、解包、解析与 schema 校验，并把单段正文登记为 task-output。Task 的权威输出应是输出目录中的一个或多个文件（可为非文本），物化形态为 `tar.gz` package。

**Migration**：见 ADDED「输出目录打包为 run package」与「声明文件清单校验」；schema 校验对象转义见 ADDED「output.schema 仅校验确定性工件」。

### Requirement: 输出契约违约失败

**Reason**：模型正文不再是校验对象，「正文违约即失败」随校验对象一并废除。声明文件缺失的失败语义由 ADDED「声明文件清单校验」承接；「终态 SHALL 为 failed」的正确意图由 ADDED「确定性失败分流终态」承接。

**Migration**：产物登记改为输出 package 及其文件清单；确定性失败终态见 ADDED「确定性失败分流终态」。

## ADDED Requirements

### Requirement: 输出目录打包为 run package

Task 的权威输出是平台为本次运行分配的临时输出目录中的文件集合。物化点 SHALL 按以下顺序执行且不可省略：① 运行前为该 slice 分配唯一临时输出路径，并将该路径注入任务上下文（任务可向该目录写入一个或多个文件，含非文本）；② 运行成功结束后将该目录打包为单个 `tar.gz`；③ 将 package 上传并登记为该 run 的权威产物（media type 为 gzip 压缩包）。SHALL NOT 将模型正文本身登记为权威产物，SHALL NOT 对正文执行 JSON 解析、解包或 schema 校验。声明 `output.schema` 与否，物化行为 SHALL 一致。打包 SHALL 安全受限：仅收录输出目录内相对路径条目，拒绝路径穿越、绝对路径、符号链接与非常规条目；条目数、解包总体积与单文件体积 SHALL 有平台上限，超限则以稳定错误失败且不登记部分产物。

#### Scenario: 输出目录中的多个文件打成一个 package

- **WHEN** 任务成功结束且输出目录含 `brief.md` 与 `data.bin`
- **THEN** 物化点将该目录打成单个 `tar.gz` 并登记为权威产物，产物列表含 package 本身以及包内各文件的可取回引用

#### Scenario: 非文本文件进入 package

- **WHEN** 输出目录含非文本文件（如 `.png` / `.bin`）且未超平台体积上限
- **THEN** 该文件原样进入 `tar.gz`，取回 package 或该文件引用时字节与目录内一致

#### Scenario: 模型正文不再是权威产物

- **WHEN** 模型产出描述性正文（含 markdown 或内嵌 JSON 片段）
- **THEN** 正文不经过 JSON 解析或 schema 校验，也不单独登记为 task-output；权威产物仅为输出目录打包后的 package

#### Scenario: 空目录且无正文可回写则无产物

- **WHEN** 任务成功结束、输出目录为空、且没有可回写的模型正文
- **THEN** 不登记输出 package，行为与既有无产物路径一致

### Requirement: 模型正文兼容回写输出目录

当前 runtime 若只产出模型正文、且输出目录在运行结束时仍为空，物化点 SHALL 将正文写入输出目录后再打包：文件名为声明的 `output.files` 首项，未声明时为 `output.md`。该回写仅用于兼容存量文本 App，SHALL NOT 把正文提升为权威产物形态。

#### Scenario: 仅有正文时回写默认文件再打包

- **WHEN** 任务成功、输出目录为空、模型正文非空、且 Task 声明 `output.files: [brief.md]`
- **THEN** 物化点将正文写入 `brief.md`，再打包上传，package 内含 `brief.md`

#### Scenario: 未声明 files 时回写 output.md

- **WHEN** 任务成功、输出目录为空、模型正文非空、且 Task 未声明 `output.files`
- **THEN** 物化点将正文写入 `output.md` 后打包上传

#### Scenario: 目录已有文件则不回写正文

- **WHEN** 输出目录在运行结束时已有至少一个文件
- **THEN** 物化点不把模型正文额外写入目录，只打包已有文件

### Requirement: 声明文件清单校验

Task 声明的 `output.files` SHALL 解释为相对输出目录的期望文件名清单。打包前，声明的每个文件 MUST 存在于输出目录（含兼容回写之后）；缺失任一声明文件时，slice SHALL 以稳定错误 `PACKAGE_OUTPUT_MISSING_FILE` 失败，SHALL NOT 登记 package，任务终态 SHALL 为 `failed`。未声明的额外文件 SHALL 被收入 package。未声明 `output.files` 的 Task SHALL NOT 因文件名清单失败。

#### Scenario: 声明文件齐全则登记清单

- **WHEN** Task 声明 `output.files: [brief.md]` 且打包前该文件存在于输出目录
- **THEN** package 登记成功，产物列表含 `brief.md` 的具名引用，取回内容即该文件字节

#### Scenario: 声明文件缺失则失败

- **WHEN** Task 声明 `output.files: [brief.md, chart.png]` 且打包前缺少 `chart.png`
- **THEN** slice 以 `PACKAGE_OUTPUT_MISSING_FILE` 失败，不登记 package，任务终态为 failed

#### Scenario: 额外文件被收入 package

- **WHEN** Task 声明 `output.files: [brief.md]` 且输出目录另有 `notes.txt`
- **THEN** package 同时包含 `brief.md` 与 `notes.txt`，两者均可取回

### Requirement: output.schema 仅校验确定性工件

`output.schema` SHALL 仅用于校验由确定性生产者产出的结构化工件，SHALL NOT 以模型文本或输出 package 内的任意文件为默认校验实例。manifest 未声明确定性工件与 schema 的绑定（当前版本无该声明字段）时，已声明的 `output.schema` SHALL NOT 产生任何运行期校验，SHALL NOT 影响任务终态；编译与登记 SHALL 继续接受该字段以保持既有包兼容。

#### Scenario: 无绑定声明的 schema 不产生校验

- **WHEN** Task 声明 `output.schema` 但 manifest 未绑定任何确定性工件
- **THEN** 运行期无任何 schema 校验发生，任务终态仅取决于 agent run 与输出目录物化结果

#### Scenario: 模型文本永不作为 schema 实例

- **WHEN** 任意 Task 声明了 `output.schema`
- **THEN** 任何运行期校验路径 SHALL NOT 将模型正文作为 schema 实例

### Requirement: 确定性失败分流终态

package run slice 的确定性前置失败（未产生外部副作用、以稳定错误码分类，如 provider 依赖缺失、输出目录超限、声明文件缺失）SHALL 使任务以 `failed` 终态落投影，投影与 task API SHALL 携带稳定错误码与失败明细，web 任务详情 SHALL 展示错误码与明细且重试控制可用；此类失败 SHALL NOT 终结于 `effect_unknown`，SHALL NOT 锁定重试/取消控制。`effect_unknown` 仅保留给无法判定外部副作用是否已发生的场景。

#### Scenario: 确定性失败终态 failed 且明细可见

- **WHEN** slice 因稳定错误码失败且该失败不涉及外部副作用
- **THEN** 任务终态为 failed，投影与 task API 含该错误码与明细，任务详情页展示原因且可重试

#### Scenario: 不再吞成 effect_unknown

- **WHEN** 上述确定性失败发生
- **THEN** 任务不进入 `effect_unknown` 裁决态，不触发效果裁决流程，控制不被锁定
