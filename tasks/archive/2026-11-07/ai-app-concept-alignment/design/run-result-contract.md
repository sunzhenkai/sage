# 设计：可校验运行结果文件（RunResult.v1）

依据：`platform/architecture/ai-app-concept.md` §7。本轮整改只实现「运行结果文件」契约；其余差距显式保留（见 PLAN 文档项）。

## 契约

每次包运行产出一份 `run-result.json`，由 worker 在物化点生成、按平台内置 schema 校验（复用 `validateJsonSchemaSubset`），包无需声明。

```json
{
  "schemaVersion": "RunResult.v1",
  "taskId": "pkg-...",
  "releaseId": "sha256:...",
  "status": "succeeded | failed",
  "files": [{ "name": "brief.json", "bytes": 1234 }],
  "failureCode": "PACKAGE_OUTPUT_CONTRACT_VIOLATION",
  "failureDetail": "...",
  "finishedAt": "2026-11-07T02:00:00.000Z"
}
```

- `files`：产物包内文件清单（name + bytes）；成功时必填（可为空数组），失败时省略。
- `failureCode` / `failureDetail`：仅失败时；detail 截断（沿用投影 2048 上限）。
- 外部产物位置字段（数据库/远端）本轮不加：当前实现只有文件产物，非文件形态是显式保留的限制，届时再扩契约。

## 生成与失败语义

- **成功路径**（`apps/agent-worker/src/activities.ts` 物化点）：生成 `run-result.json` 写入输出目录，随产物一起 `packOutputDirectory` → `task_run_output`。`run-result.json` 为平台保留文件名，不参与 `assertDeclaredFiles` 校验；包产物中同名文件在物化点被平台生成覆盖，文档注明保留名，不动编译器。
- **失败路径**：slice 失败（含输出契约违约）时写最小 `run-result.json`（status=failed + failureCode/detail）到 `task_run_output`，使「每次运行都有可校验结果」成立。写入按既有 `writeRunOutput` 语义幂等；activity 重试重复写同一 taskId 不产生新产物。
- API 读取走既有 `/v1/tasks/:taskId/artifacts` + `run-output-resolver`，无需新端点。

## 明确不做

- skill/capability 包加载、生产准入、权限模型、Release channel、非文件业务产物：均为有意保留的限制，写入概念文档实现状态节。
