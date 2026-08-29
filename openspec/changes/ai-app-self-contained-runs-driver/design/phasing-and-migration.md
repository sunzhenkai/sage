# 分阶段落地与迁移 — 方案对比、子变更拆分、在途吸收

> 暂存于 driver design/，归档落点 `docs/design/ai-app/phasing-and-migration.md`。

## 1. 落地路径选型

| 方案 | 成本 | 风险 | 可逆性 | 工期 | 复杂度 |
|------|------|------|--------|------|--------|
| A：渐进兼容（v2 全增量可选 + 隐式单任务缺省 + deprecation 窗口） | 中 | 低（存量逐字节不变，golden 钉死） | 高（任一阶段可停） | 6 个子变更，可并行部分 | 中（契约有缺省分支） |
| B：一刀切（v2 强制显式 tasks，存量重登记，runs API 直接换新） | 高 | 高（阻塞所有 App 作者与 P8 在途） | 低 | 3 个子变更 | 低（契约单一） |
| C：仅加参数字段，不引入 tasks 声明 | 低 | 高（调度入口选择与输出判定仍无解，P8 缺陷固化） | 中 | 2 个子变更 | 低 |

**推荐：方案 A**，因为存量 Release 的不可变审计链与在途 P8 都不能承受「必须重登记才可运行」，且 A 的每个子变更独立可验收、可停在任意阶段。
接受的取舍：manifest 存在隐式缺省分支（以 v1 逐字节等价 golden 测试钉死）；`input` 字段需要一个 deprecation 窗口。
回退计划：v2 字段全可选 → 回滚任一子变更即回到 v1 行为；已按 v2 运行的 Run 输入已物化，不受影响。

## 2. 子变更拆分（`ai-app-self-contained-runs-*`）

| # | 子 change | 内容 | 依赖 | 可并行 |
|---|---|---|---|---|
| A | `…-manifest-v2` | manifest v2 契约（inputs/dataSources/tasks/output 绑定）+ 编译进 lock + 校验 + v1 golden | — | 与 B/C 可并行开发 |
| B | `…-input-binding` | 准入参数解析（校验+默认值+幂等键）、dataSources 受控出口抓取与 onFailure 语义、`input` 字段 410、组装输入扩展；**吸收 `package-run-input-snapshots` 全部内容** | A | — |
| C | `…-output-contract` | 物化点 think 剥离 + schema/files 强制校验 + 前端产物内联渲染 | A | 与 B 可并行 |
| D | `…-schedule-binding` | 修订 P8 提案：schedule 绑定 releaseRef+task+固化 params、follow 兼容性失败语义；在 P8 change 内落地 | B、P8 排序 | — |
| E | `…-model-route` | modelRoute 参与执行解析（App 声明优先，workspace run-agent-settings 兜底），run-agent-settings spec 定位重审 | A | 与 C 可并行 |
| F | `…-examples-ui` | 三示例 v2 重造（github-trending 数据源+参数；lifecycle-probe 改确定性自输入探针；ops-analyst 参数化）、前端发起表单参数化+空输入警告移除、导入按钮对齐 | B、C | — |

排序约束：**D 之前必须完成 A+B**（否则调度面建立在缺陷上）；F 收尾。A/B/C/E 之间契约若先冻结（本设计 3.x 即契约草案），可多 agent 并行。

## 3. 在途变更吸收

- `package-run-input-snapshots`（已 validate 通过、未实施）：spec/design 内容并入 `…-input-binding`（快照注入、受控出口白名单、fail-closed 语义全部保留），差异仅两点——`inputSnapshots` 更名为 `dataSources` 并入 manifest v2、`onFailure: markMissing` 作为新增声明项。吸收完成后归档原 change（从未 apply，无迁移负担）。
- `sage-p8-unattended-schedule-pilot`（已立项、未实施）：D 子变更直接修订其 proposal 的 schedule 绑定契约（`{releaseRef, task, params, releasePolicy}`），其余（无人值守自治、预算账户、pilot 门）不动。建议 P8 的实施排期晚于 A+B 完成。
- 本次会话早前的「一键导入示例」前端改动（已实现未提交）：与 F 无冲突，F 在其上迭代（导入的示例换成 v2 定义）。

## 4. 迁移与兼容

- **v1 Release**：永久只读兼容。运行时把无 `tasks` 声明的 manifest 视为隐式单任务（entry=顶层 entry、无参数、无数据源、无输出强制），行为逐字节等价——golden 契约测试（既有 Release 的准入请求/响应/组装输入/产物摘要快照）在 B/C 落地前后必须逐字节一致。
- **runs API**：`input` 字段 B 阶段起返回 `410 INPUT_REMOVED`（信息指引用 params 或 Chat）；前端同版本切换，不存在中间态用户。
- **CLI**（`register-package.ts`）：不变（目录扫描与上传格式无感知 manifest 版本）。
- **前端**：发起表单由 `/v1/apps/:id` 详情返回的 inputs 声明渲染（文本/枚举控件 + 默认值）；App 详情展示 tasks 与数据依赖清单。

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 隐式缺省分支导致双语义漂移 | v1 golden 逐字节测试进 CI；缺省分支实现集中在 manifest 归一化一处 |
| 输出强制校验误伤存量 App | 仅对声明 schema 的 Task 生效；v1 等价路径跳过；错误信息给出违反点与豁免方式 |
| 快照注入引入准入延迟/外网依赖 | 10s×条超时、512KiB×条上限、markMissing 可声明；失败信息含白名单配置指引 |
| P8 排期耦合 | 排序约束写入 driver tasks；D 只改绑定契约，不阻塞 P8 其余能力 |
| breaking 面失控 | 唯一移除项是 `input` 字段，走 410 窗口；其余全部增量 |

## 6. 未决问题（不阻塞提案，子变更内裁决）

1. params 类型系统 v2 是否引入 array/object（v1 建议 string/enum/number）。
2. `markMissing` 时 assembled input 的标注格式（`[snapshot … unavailable]`）是否需要进 spec 正文还是实现细节。
3. modelRoute「App 优先」与 workspace 兜底的精确解析表（E 内出 ADR）。
4. think 剥离的 reasoning 是否作为独立产物保留（默认丢弃，C 内定）。
