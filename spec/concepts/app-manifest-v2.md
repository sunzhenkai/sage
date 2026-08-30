# App Manifest v2

P8(driver `ai-app-self-contained-runs`)引入的 App 自闭环声明格式:App(Release)的**输入、处理、输出**三段全部在契约内,Run 创建即闭环。

## 定义

`app.yaml` 升级到 `schemaVersion: '2'`(全部新增字段可选,缺省 = v1 等价):

- **inputs**:App 级参数声明(string/enum/number + 默认值、required);
- **dataSources**:声明式数据依赖(`capability://` 引用、public HTTPS URL、maxBytes、`onFailure: fail | markMissing`);
- **tasks**:命名入口 map——每个 Task 绑定 entry prompt、参数绑定(`params` 引用 inputs)、输出契约(`output.schema` + `output.files`);缺省 = 隐式单任务(v1);
- **modelRoute**:provider/model/fallbacks,Phase 起参与执行解析;
- 校验:未知字段拒绝、inputs/dataSources 各 ≤8 条、URL 必须 public HTTPS 无凭据、task 名唯一、params 只能引用已声明 inputs。

配套语义(ADR `docs/adr/2026-08-29-task-as-declared-entry.md`):

- **Task = 声明的命名入口(定义),Run = 执行实例**;运行时自由文本输入被移除(`POST /v1/runs` 出现 `input` 即 410 `INPUT_REMOVED`),人工自由文本只属于 Chat(经 promotion 一次性物化);
- **输出契约在物化点强制**:worker 写输出前剥离 think 段、解 JSON 围栏、按 `task.output.schema` 校验、按 `files` 登记产物;违反即 `PACKAGE_OUTPUT_CONTRACT_VIOLATION`(任务失败,可重试);
- digest 覆盖全部声明,审计可重建。

## 容易混淆的近义

- **inputs(声明)vs params(值)**:inputs 在 manifest 里声明形状;params 是一次触发提交的值,按声明校验后随 Run 固化;
- **AgentTaskSpec**(见 [agent-task-spec](agent-task-spec.md))不变:Run 仍由 Release + 输入派生,v2 只改「定义的形状」与「准入的输入解析」。

## 出现在

- 模块 [release-and-admission](../modules/release-and-admission/README.md)(manifest 解析/编译/准入)、[apps](../modules/apps/README.md)(runs-api 声明式输入、worker 输出契约);
- 示例 `platform/examples/ai-apps/`(`finance-briefing` 展示全部 v2 特性);
- 设计 `docs/design/ai-app/app-task-run-model.md` 与 `docs/design/ai-app/phasing-and-migration.md`。

来源:`platform/packages/agent-package-release/src/source-manifest.ts`、`platform/packages/agent-run-admission/src/package-input.ts`、`platform/apps/agent-worker/src/output-contract.ts`。
