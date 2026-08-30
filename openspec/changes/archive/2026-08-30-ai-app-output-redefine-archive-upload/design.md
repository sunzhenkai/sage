# Design：AI App 输出定义修正与压缩包上传

## Context

- 见 `proposal.md` Why。当前物化把 `outcome.output`（模型正文）经 `enforceOutputContract` 写入 `task_run_output.output`（文本列），`output.files` 只是同一正文的具名别名。
- worker store 只有 `claimSlice / commitSlice / markEffectUnknown / cancelSlice`，没有把 `failed` 写入 `task_projection` 的路径。
- 上传端点仅接受 JSON `files`；源包安全边界在 `packages/agent-package-release/src/source-loader.ts`。
- 普通 Package 不获得原生执行权（无包内脚本）。当前 runtime 没有通用写文件工具；输出目录的第一批写入者是 worker 自身（兼容回写）与后续被限制在该目录内的工具。

## Goals / Non-Goals

**Goals:**
- 权威产物 = 输出目录打包的 `tar.gz`；运行时固定三步：分配临时路径 → 打包 → 上传。
- 废除正文 JSON 闸门；`output.files` 按目录内期望文件校验；存量文本 App 经兼容回写仍能产出 package。
- 确定性失败 → `failed`（错误码 + 明细进投影/API/UI）；`effect_unknown` 收窄。
- 源包压缩包 multipart 上传 + 安全解包 + UI 文件选择器；JSON 通道保留。

**Non-Goals:**
- 不引入包内脚本，不开放通用文件系统。
- 不新增「schema ↔ 确定性工件绑定」manifest 字段。
- 不把 dataSources 快照强制写入输出目录（快照仍走既有准入注入；若实施时顺手写入输出目录，不作为本 change 验收项）。
- 不改 coordinator workflow 分片骨架，不动 schedule 触发语义。

## Decisions

**D1 输出物化三步由 worker 拥有，目录是唯一写入面**
slice 开始时 `mkdtemp` 分配唯一输出目录（建议名含 `taskId` + `sliceNumber`），将绝对路径注入 assembled input 的固定段落（键名 `SAGE_OUTPUT_DIR`），并在 activity `finally` 中删除临时目录。agent 成功返回后：若目录为空且正文非空，按 spec 回写默认文件；校验 `output.files`；用流式 tar + gzip 打包（相对路径、无符号链接）；上传登记。备选「继续把正文当 task-output、files 只是别名」被否：无法容纳多文件与非文本。备选「每个文件单独上传」被否：权威形态必须是一个 package。

**D2 package 存储：postgres bytea + 文件清单，artifact 引用分层**
`TaskRunOutputRecord` 扩展：`output` 文本列改为可空（存量行保留）；新增 `package_bytes`（bytea）与 `file_manifest`（json：`name` / `sizeBytes` / `mediaType`）。`mediaType` 对权威产物为 `application/gzip`。`task_artifact_reference` 登记：
- package 行：`name=output.tar.gz`，`artifactRef` 无 fragment；
- 每个包内文件一行：`name=<相对路径>`，`artifactRef=...#file/<path>`。
取回 package 返回 gzip 字节；取回 `#file/` 时从 package 按名解出单条目（文本预览走 utf-8，失败则按 octet-stream 下载）。备选「先接 artifact-store / MinIO」被否：本 change 的 package 有明确体积上限，postgres 一跳即可，避免把 writer 注入 agent-api/worker 做成阻塞项；后续体积上涨再迁对象存储，契约不变。

**D3 输出 package 上限（与源包解包上限分开）**
输出目录：条目数 ≤256、解包总体积 ≤16 MiB、单文件 ≤8 MiB、生成的 `tar.gz` ≤20 MiB。源包上传仍用既有更严上限（条目 ≤256、解包 ≤4 MiB、单资产 ≤512 KiB、multipart ≤8 MiB）。超限稳定错误码 `PACKAGE_OUTPUT_LIMIT_EXCEEDED`，走 `failed` 分流。

**D4 废除闸门的方式：移除调用点，保留纯函数**
`activities.ts` 删除对正文的 `enforceOutputContract`。`output-contract.ts` 的 `stripThinkSegments / unwrapJsonFence / validateJsonSchemaSubset` 保留为工具函数（UI 预览折叠 think、未来确定性工件校验）。`runContract` 形状不变：`schema` 继续随包输入物化进审计，worker 只消费 `files` 做存在性检查。

**D5 确定性失败分流：分类先行，worker 侧落投影**
- `AgentSliceResult` 增加 `outcome: 'failed'`（`failureCode`、`detail`）；store 新增 `markSliceFailed`。
- catch 分类：`ApplicationFailure` 且 `nonRetryable`（含 `PROVIDER_DEPENDENCY_MISSING`、`PACKAGE_OUTPUT_MISSING_FILE`、`PACKAGE_OUTPUT_LIMIT_EXCEEDED`）→ `markSliceFailed` 后重抛；可重试且未到上限 → 直接抛出；最后一次尝试或意外崩溃 → `markSliceFailed`（`ACTIVITY_FAILED`）后抛出；仅 claim 丢失 / abort 竞态残留保留 `markEffectUnknown`。
- `task_projection` 新增可空列 `failure_code`、`failure_detail`；`failed` 纳入可重试控制集合。

**D6 源包压缩包解包：魔数判型 + 条目级自校验**
新模块 `packages/agent-package-release/src/source-archive.ts`：按魔数判型（gzip `1f 8b`、zip `PK`、tar ustar），不信任后缀；gzip 解压后递归判型一层（内层须为 tar/zip；纯文本 gzip 拒绝）；嵌套深度上限 1。解析库实施时在 `tar-stream` / `yauzl` / `fflate` 中按零传递依赖、流式、维护活跃度选型。路径穿越、符号链接、条目/体积上限在条目回调内自校验，违规整体拒绝。解包产物喂给 `loadSourcePackageFromFiles`。`@fastify/multipart`（fileSize 8 MiB）挂同一路由按 content-type 分流。

**D7 UI**
- `packages.tsx`：JSON textarea → `<input type="file" accept=".tar,.tar.gz,.tgz,.gz,.zip">` + 前端预检。
- `tasks.tsx`：成功态展示 package 下载链 + 文件清单；`TaskOutputPreview` 只对文本 `mediaType`（`text/*`、`application/json`）内联渲染，其余显示下载。失败态展示 `failureCode + failureDetail`，重试可用。
- locale 双语同步。

## Risks / Trade-offs

- [存量消费方假定 task-output 为 JSON/纯文本] → 权威产物改为 `application/gzip`；兼容回写保证文本 App 仍有可读文件；UI 按 mediaType 分流预览。
- [postgres 存 20 MiB bytea 放大] → 硬上限 + 仅终态写一次；超限走 failed。对象存储迁出不改契约。
- [临时目录泄漏或路径穿越] → `finally` 删除；打包与任何写入都拒绝 `..` / 绝对路径 / 符号链接；单测覆盖。
- [可重试错误重试期间重复执行] → 分流只对无外部副作用的确定性失败落终态；可重试路径沿用 lease 过期重认领，补 claimSlice 单测。
- [zip/tar 解析器漏洞] → 魔数判型 + 条目级自校验 + 体积双上限 + 负向测试集。
- [effect_unknown 收窄后告警减少] → 这是目标；观测 `sage_task_effect_unknown_total`。

## Migration Plan

1. 迁移：`task_projection` 新列 + `task_run_output` 的 `package_bytes` / `file_manifest`（`output` 文本列可空）。
2. worker：三步物化 + 闸门废除 + 失败分流。
3. artifact API / web：package 下载与文件预览。
4. multipart 源包上传 + 示例 App + 测试。
5. 存量已声明 `output.schema` 的 Release 无需重传（惰性）。存量已物化的文本 `task_run_output` 行保持可读；新 run 只写 package。
6. 回滚：代码 revert，新列保留无害。

## Open Questions

- 输出目录注入段落的最终文案（中英）实施时与 assembled input 现有分段对齐即可，不影响契约。
