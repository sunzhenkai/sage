## ADDED Requirements

### Requirement: 常规投影推进写入 Task Timeline 事件

任务投影在常规链路（非 reconciler 修复路径）发生 lifecycle 推进或产出修订时，SHALL 向 task timeline 事件存储同步追加对应的 projection 事件，使任务详情的 Timeline 呈现该任务真实的状态迁移历史。事件写入 SHALL 与投影更新保持一致的粒度与顺序（按 revision 递进），且 SHALL NOT 阻断或回滚投影本身的推进——事件写入失败 SHALL 可观测并按既有 stale 语义处理。任务详情 Timeline 为空 SHALL 仅出现在该任务确无任何已记录投影事件的场景（如仅 reconciler 修复前的 legacy 数据）。

#### Scenario: 成功任务呈现 Timeline 历史

- **WHEN** 一个任务经常规链路从创建推进到 succeeded 且投影 revision 前进
- **THEN** 任务详情的 Timeline 列出对应的投影事件（含状态迁移），而非恒定显示 "No projection events have been recorded yet"

#### Scenario: 事件写入失败不回滚投影

- **WHEN** 投影推进成功但 timeline 事件追加失败
- **THEN** 投影保持已推进状态，失败可观测（日志/指标），任务不因事件缺失而误判为 stale

#### Scenario: 顺序与投影一致

- **WHEN** 同一任务的多次投影推进先后发生
- **THEN** 对应 timeline 事件按与 revision 一致的顺序可被顺序读取，不出现乱序覆盖
