# AI App 输出定义修正与压缩包上传

## Why

Task 的最终产出不是模型描述性正文，而是输出目录里的一个或多个文件（可为非文本）。现行契约把 `output.schema` 当成「模型正文必须是合法 JSON」的物化闸门，正文踩闸后又被 activity catch-all 吞成 `effect_unknown`——约 20/46 次 package run 因此锁死，且 UI 只能按单段文本渲染 `task-output`。需要把 run output 重定义为「平台分配的临时输出目录 → 打包为 tar.gz → 上传平台」的 package；同时「上传 App 新版本」也应对齐「上传的是一个 package」，不再只支持粘贴 JSON 文本框。

## What Changes

- **BREAKING** `package-output-contract` 重定义：Task 的权威输出是输出目录中的文件集合，物化形态为单个 `tar.gz` package（不是模型正文、也不是「把正文登记成 brief.md」）。运行时三步：① 为本次 slice 分配临时输出路径并注入任务上下文；② 运行结束后打包该目录为 `tar.gz`；③ 将 package 上传并登记为 run 产物。
- 模型正文不再进入任何 JSON 解析/校验闸门；声明 `output.schema` 与否不影响物化。`output.schema` 仅保留为确定性工件的惰性声明（无绑定则不产生运行期校验）。
- `output.files` 语义转义：相对**输出目录**的期望文件名清单。声明的文件在打包前必须存在，否则任务 `failed`；未声明的额外文件允许进入 package。目录为空且无正文可回写时，行为与既有「无产物」路径一致。
- 兼容回写：当前 runtime 若只产出模型正文、且输出目录为空，worker SHALL 把正文写入声明的首个 `output.files` 名（未声明则 `output.md`）后再打包——保证存量文本 App 仍能产出合法 package，但不把正文本身当作权威产物。
- 示例 App 修正：`finance-briefing`、`github-trending` 移除「按 output.schema.json 输出 JSON」的提示词；产物改为输出目录中的具名文件（如 `brief.md` / `report.md`）。
- **确定性失败分流**：package run slice 的确定性前置失败 SHALL 以 `failed` 终态落投影（稳定错误码 + 明细，UI 可见可重试），SHALL NOT 终结于 `effect_unknown`。
- **BREAKING** 上传新版本改为真实源包文件：`POST /v1/apps/:appId/releases` 新增 multipart/form-data 通道，接受单个压缩包（tar / tar.gz / tgz / gzip 单文件 / zip），服务端安全解包后走既有目录约定编译；原 JSON `files` 通道保留兼容。
- 包详情页「上传/更新版本」改为压缩包文件选择器；任务详情对成功 run 展示输出 package（下载 tar.gz、列出包内文件、文本文件可预览，二进制仅下载）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `package-output-contract`: 重写输出定义——权威产物为输出目录打包的 `tar.gz`；废除正文 JSON 闸门；`output.files` 转为目录内期望文件清单；`output.schema` 转义为确定性工件惰性字段；新增确定性失败分流。
- `package-management-interface`: 「上传/更新版本」改为压缩包文件上传；运行追踪对成功 run 展示输出 package（下载 / 文件清单 / 文本预览），对 `failed` 终态展示稳定错误码与明细。

## Impact

- **worker**：`platform/apps/agent-worker/src/activities.ts`（分配临时输出目录、注入上下文、打包、上传、废除正文闸门、确定性失败分流）、新增输出目录打包器；`platform/apps/agent-worker/src/output-contract.ts`（校验对象不再是模型正文；声明文件存在性检查）。
- **存储与 API**：`writeRunOutput` 从「单段文本」扩展为 package 字节 + 文件清单；artifact 端点可取回 `tar.gz` 与包内单文件；`task_projection` 新增 `failure_code` / `failure_detail`。
- **投影与 UI**：`platform/apps/agent-web/src/tasks.tsx` 输出区改为 package 下载 + 文件清单 + 文本预览；`locale.tsx` 双语文案。
- **上传链路**：`platform/apps/agent-api/src/apps-api.ts`（multipart）、`platform/packages/agent-package-release`（源包压缩包解包器）、`platform/apps/agent-web/src/packages.tsx`。
- **示例与测试**：`platform/examples/ai-apps/` 与 `apps/agent-web/src/example-apps.ts`；output-contract / worker / apps-api / web 相关测试与 golden。
- **spec**：`openspec/specs/package-output-contract/spec.md`、`openspec/specs/package-management-interface/spec.md`。
