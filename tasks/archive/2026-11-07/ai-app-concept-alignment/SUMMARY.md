# SUMMARY

## 交付与验证

按 `platform/architecture/ai-app-concept.md` 概念定义整改 sage 实现，交付两个提交（分支 `task/ai-app-concept-alignment`，worktree `worktrees/ai-app-concept-alignment/sage`）：

1. `docs(architecture): add AI App concept definition`——AI App 概念文档（App/Release/Run、声明与绑定分离、输出两层：业务产物 + 可校验运行结果文件）。
2. `feat(agent-worker): emit verifiable run-result.json for package runs`——RunResult.v1 契约实现。

验证（详见 `evidence/verification.md`）：typecheck / lint exit 0；agent-worker 126 测试全过（含新 4 例单测、集成断言成功/失败两形态）；agent-api src 188 通过 / 14 跳过。

## 最终机制

- 成功路径：`activities.ts` 物化点生成 `run-result.json`（taskId / releaseId / status / files 业务清单 / finishedAt），随产物包 gzip 写入 `task_run_output`；`files` 不含结果文件自身；包产物同名文件被平台生成覆盖（保留名，不动编译器）。
- 失败路径：`classifySliceFailure` = failed 分支写最小结果（status=failed + failureCode/detail，文本形态 `application/json`）；写入异常只记日志，不改变失败语义。
- 结果确定才写：effect_unknown / retry / cancelled 不写结果文件。
- 其余概念差距（skillRefs/capabilityRefs 纯声明、local-only 准入、权限/channel、非文件业务产物）在概念文档 §9 显式标注为有意保留的限制。

## 关键决定

- 契约模块放 `apps/agent-worker/src/run-result.ts`（生成 + 内置 schema 自检复用 `validateJsonSchemaSubset`），API 面无改动，读取走既有 artifacts `#file/` 路径。
- 失败结果文件与成功产物互斥（一个 task 一个终态），复用 `writeRunOutput` 幂等语义。

## 认知更正

- 初版 `buildRunResult` 直接传 readonly 数组给 `JsonValue` 参数导致 TS 失败：`validateJsonSchemaSubset` 的数组分支是可变类型，构造时拷贝一层解决。

## 剩余风险与后续项

- 失败结果文件的 API 取回（`#file/run-result.json` 走文本分支）依赖既有 resolver，无新增专项测试。
- 非文件业务产物、skill/capability 运行时加载、生产准入、权限/channel 为显式保留限制，概念文档已列。
- 合入方式：worktree 分支 → push → PR；主工作区 `platform/architecture/ai-app-concept.md` 有一份本会话创建的未提交副本，合入后需删除以免 untracked 冲突。
