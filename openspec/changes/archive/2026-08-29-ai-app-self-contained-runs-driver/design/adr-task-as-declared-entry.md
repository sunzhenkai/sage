# ADR：Task 是 App 内声明的命名入口，Run 才是执行实例

- 状态：提议（暂存于 driver design/，归档晋升至 docs/adr/）
- 日期：2026-08-29
- 决策级别：平台契约（manifest / admission / schedule 三面同改）

## 背景

现状把「Task」当作运行实例（`pkg-*` taskId），而 App（Release）只有单一隐式入口（entry prompt）。后果：

1. 运行时自由文本输入成为事实上的任务定义补充（`POST /v1/releases/:id/runs` 的 `input`），任务不自闭环；
2. P8 无人值守调度的触发器（scheduleId + occurrenceId）没有输入来源定义，隐含「空输入运行」，对不自闭环的 App 只会 7×24 产出「请提供数据」；
3. App 无法表达「我能做哪几件事」，schedule 无法表达「定时做哪一件」；
4. 输出契约（output.schema.json）纯声明，任务成败无法依据输出判定。

参照系 fengine-ai-apps（生产 crontab 运行的旁路 MVP）验证了相反的模型：`app.yaml` 内 `tasks:` map 声明命名入口，每个 Task 绑定 workflow 与 output；运行实例由调度产生，输入全部来自声明（`required_env`、`default_scope`）与部署注入，无运行时人工喂入。

## 决策

1. **Task** = App manifest 内声明的命名入口：`tasks.<name>` 绑定入口 prompt、参数绑定、数据依赖引用与输出契约。Task 是定义，不是实例。
2. **Run** = 一次执行实例（现 taskId 所指对象）：创建时把 Task 定义 + 解析后的参数值 + 数据快照物化为输入，之后 retry/重放/调度复用同一输入，闭环不再变化。
3. **人工自由文本只存在于 Chat**：经 chat-to-task promotion 在提升瞬间一次性物化为 Run 输入（该模式已符合本决策，确认为全平台语义模板）。
4. **失败语义由 App 声明**：数据依赖缺省 `onFailure: fail`（fail-closed），可声明 `markMissing`（部分覆盖继续，报告标注缺失）——巡检类与数据依赖类任务的正确语义不同，平台不做一刀切。
5. **声明式纯度不退让**：不采纳 fengine 的包内可执行工具模式；工具/能力由平台注册表提供并在准入/执行边界兑现，App 只写 `capability://` 引用。

## 后果

正面：调度输入来源问题消解（schedule 绑定 Release+Task+固化参数）；App 语义完整（输入/处理/输出三段全在契约内）；输出可判定；示例与 UI 获得明确形态。

代价：manifest 契约升级（v2，增量字段 + 兼容缺省）；runs API 的自由 `input` 进入废弃窗口后移除（BREAKING，局部）；准入复杂度上升（参数校验 + 数据依赖解析）。

不采纳的替代：维持现状 + 仅加参数字段（不解决调度入口选择与输出判定）；模型自主工具循环获取数据（把确定性依赖交给模型决策，与治理与可审计目标冲突，且需 harness 多轮化）。
