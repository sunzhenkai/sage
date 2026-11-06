# task-state-integrity Specification

## Purpose
定义任务执行状态在 workflow、执行分片账本与控制台投影之间的一致性契约，确保任何失败、取消或重试都能被结算成唯一、可读、可重建的状态。

## Requirements

### Requirement: 分片认领租约随心跳续期

系统 SHALL 为每个执行分片维护可续期的认领租约，租约时长 SHALL 显著短于临时错误的重试窗口，并在分片执行期间由心跳持续续期。租约过期后，新的投递 SHALL 能重新认领该分片并继续执行。

#### Scenario: 首次投递丢失后重投可接管

- **WHEN** 一次分片投递写入认领后未能完成（进程退出或启动回执丢失），且租约已过期
- **THEN** 下一次投递 SHALL 重新认领该分片并执行，而不是返回"已在执行中"

#### Scenario: 执行中的分片不被并发接管

- **WHEN** 一个分片正在执行并持续发送心跳，另一个投递同时到达
- **THEN** 系统 SHALL NOT 让第二个投递并发执行同一分片

### Requirement: 可重试失败必须真正重跑

系统 SHALL 把被判定为可重试的失败交还给执行引擎重试，重试 SHALL 重新执行分片；系统 SHALL NOT 因为上一次失败留下的认领状态而使重试在分片未执行的情况下耗尽。

#### Scenario: 瞬时错误后重试成功

- **WHEN** 分片第一次执行因瞬时错误失败，重试时依赖已恢复
- **THEN** 重试 SHALL 重新执行分片并最终成功，任务状态 SHALL 收敛为 `succeeded`

#### Scenario: 重试耗尽才算失败

- **WHEN** 分片在允许的全部重试中持续失败
- **THEN** 任务状态 SHALL 收敛为 `failed`，且投影 SHALL 记录该任务的失败码与详情

### Requirement: 手动重试以新代次执行

手动重试 SHALL 为失败分片开启新的执行代次，并以该代次重新调用执行器；系统 SHALL NOT 把上一次失败的结果当作本次执行的结果，也不得把失败结果报告为成功。

#### Scenario: 重试不会复用失败结果

- **WHEN** 任务的分片已结算为失败，用户对任务发起重试且依赖已恢复
- **THEN** 系统 SHALL 重新执行该分片，任务最终状态由本次执行结果决定

#### Scenario: 重试后仍然失败

- **WHEN** 任务重试后分片再次失败
- **THEN** 任务状态 SHALL 保持 `failed`，并 SHALL 记录本次代次的失败码

### Requirement: 工作流终态必须写入投影

任务工作流在返回任何终态（`succeeded`、`failed`、`cancelled`、`effect_unknown`）之前 SHALL 写入与终态一致的投影。投影写入失败 SHALL NOT 改变工作流的终态结果。

#### Scenario: 分片预算耗尽

- **WHEN** 任务到达分片上限仍未完成
- **THEN** 工作流 SHALL 以 `failed` 结束，投影 SHALL 同步为 `failed`

#### Scenario: 取消先于提交完成

- **WHEN** 取消信号与分片提交同时发生
- **THEN** 工作流与投影 SHALL 都收敛到 `cancelled`

### Requirement: 控制意图不被运行中分片覆盖

暂停意图 SHALL 在运行中的分片完成后继续生效；分片完成 SHALL NOT 把已暂停的任务改回 `running`。恢复操作 SHALL 只在任务确实处于 `paused` 时生效。

#### Scenario: 分片执行期间暂停

- **WHEN** 任务在分片执行期间收到暂停，分片随后正常完成
- **THEN** 任务状态 SHALL 保持 `paused`，直到收到恢复

### Requirement: 投影缺失不得伪装为确定状态

当任务没有投影或投影不可用时，查询结果 SHALL 明确标记为不可用，SHALL NOT 把任务报告为状态确定的 `running`。依赖状态的控制操作 SHALL NOT 因为投影缺失而拒绝重试或取消。

#### Scenario: 查询无投影的任务

- **WHEN** 任务已启动但尚未产生任何投影
- **THEN** 查询结果 SHALL 标记新鲜度为不可用，控制台 SHALL 能区分"状态未知"与"正在运行"

#### Scenario: 无投影任务发起重试

- **WHEN** 任务没有投影，但工作流处于可重试的失败状态
- **THEN** 重试 SHALL 被接受，而不是以"状态不适用"拒绝

### Requirement: 投影可从执行历史重建

系统 SHALL 提供投影重建能力：当投影缺失或落后于工作流状态时，系统 SHALL 能从执行历史重新生成投影并记录修复审计，而不依赖人工改库。

#### Scenario: 修复缺失投影

- **WHEN** 运维触发某任务的投影修复，或后台巡检发现投影缺失
- **THEN** 系统 SHALL 从执行历史重建投影，任务查询 SHALL 返回与工作流一致的状态

### Requirement: 残留认领可回收

已进入终态或长期没有心跳的分片认领 SHALL 可被安全回收，回收 SHALL NOT 影响已提交结果的幂等读取。

#### Scenario: 终态任务的残留认领

- **WHEN** 任务已取消或失败，账本仍存在未结算的认领记录
- **THEN** 后台清理 SHALL 回收该认领，后续重试 SHALL 能正常认领分片
