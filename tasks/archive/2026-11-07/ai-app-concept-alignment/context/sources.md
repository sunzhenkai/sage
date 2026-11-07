# 证据索引

source_repo: /home/wii/code/repos/github/sunzhenkai/sage；base commit: eb2f0e6（main，2026-11-07）。

## 差距 1：skillRefs/capabilityRefs 纯声明（confirmed）

- `packages/agent-run-admission/src/release-run.ts:137-156`：`manifest.skillRefs` 透传进 `spec.skillRefs`；`capabilityGrantRef` 取首个 `capabilityRef`，缺省 `grant://package/events`。运行时不加载独立 skill/capability 包，取数走 dataSources egress。
- `packages/agent-runtime-conformance/src/index.ts:245`：非空 skillRefs 在 conformance 引擎直接抛 `ENGINE_SKILL_CALLBACK_UNAVAILABLE`。

## 差距 2：运行准入 local-only（confirmed）

- `apps/agent-api/src/runs-api.ts:147-149`：非 local 模式返回 501 `PACKAGE_RUN_ADMISSION_NOT_AVAILABLE`（fail closed）。
- `apps/agent-api/src/runs-api.test.ts:287-291`：对应测试。

## 差距 3：权限模型 / Release channel（confirmed）

- 架构文档 `app-release-run-model.md` §7 声明未实现；代码中无对应实体。

## 差距 4：可校验运行结果文件统一契约（confirmed，本次整改核心）

- 物化管线：`apps/agent-worker/src/activities.ts:251-310`——Live harness 纯文本；`SAGE_OUTPUT_DIR` 空时把模型正文物化为首个声明文件（或 output.md）；声明 schema 走 `enforceOutputContract`；`packOutputDirectory` 打包 gzip；`writeRunOutput` 写 `task_run_output`（packageBytes + fileManifest + files）。
- schema 校验：`apps/agent-worker/src/output-contract.ts`（剥 think → JSON 解包 → JSON Schema 子集校验；违约 `PACKAGE_OUTPUT_CONTRACT_VIOLATION`）。
- 产物读取：`apps/agent-api/src/run-output-resolver.ts`（`#file/` 从 gzip 包解单条目）。
- 现状无统一 run result 文件：运行状态在 Task 投影，产物清单在 `task_run_output.files`；失败路径直接 throw，不写任何输出。
- 测试参照：`apps/agent-worker/src/output-package.integration.test.ts`、`packages/agent-package-release/src/output-archive.ts`（assertDeclaredFiles / packOutputDirectory / writeCompatOutput）。

## 附加差距：业务产物形态（confirmed）

- 概念 §7 允许写数据库/远端；当前 Live harness 无写盘与外部写入工具，产物仅文件物化一种形态（`activities.ts:253-255` 注释明示 text-only）。
