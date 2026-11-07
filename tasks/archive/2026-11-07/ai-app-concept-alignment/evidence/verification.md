# 验证记录（2026-11-07）

worktree: `worktrees/ai-app-concept-alignment/sage`，分支 `task/ai-app-concept-alignment`，base origin/main（eb2f0e6）。

## 命令与结果

| 命令 | 结果 |
|------|------|
| `corepack pnpm typecheck`（platform 根） | exit 0 |
| `corepack pnpm lint`（platform 根） | exit 0 |
| `pnpm --filter @sage/agent-worker exec vitest run` | 22 文件 / 126 测试全过 |
| `pnpm --filter @sage/agent-api exec vitest run src` | 28 文件 188 通过 / 3 文件 14 跳过 |

聚焦：`src/run-result.test.ts` 4 例（成功/失败形态、内置 schema 自检、保留名）；`src/output-package.integration.test.ts` 7 例，含成功产物含可校验 `run-result.json`（files 清单不含其自身）、契约违约失败写出最小 failed 结果。

## criterion 逐项核对

- 差距 4（可校验运行结果文件统一契约）：已实现。成功路径随产物包产出（`activities.ts` 物化点，保留名覆盖同名包产物）；失败路径（`classifySliceFailure` = failed 分支）写出最小形态；生成后按内置 schema 自检（`run-result.ts`）。测试证据如上。
- 差距 1（skillRefs/capabilityRefs 纯声明）、差距 2（local-only 准入）、差距 3（权限模型 / Release channel）、附加差距（业务产物仅文件形态）：均在 `platform/architecture/ai-app-concept.md` §9 显式标注为有意保留的限制。
- 全仓 typecheck、lint 与相关测试：全部通过（上表）。

## 未验证 / 保留项

- 非文件业务产物（写数据库/远端）：显式保留，未实现。
- 失败结果文件的 API 取回（`#file/run-result.json` 走 `output.output` 文本分支）：由 `run-output-resolver.ts` 既有逻辑覆盖，未新增专项测试。
