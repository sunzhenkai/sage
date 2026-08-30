# Tasks：AI App 输出定义修正与压缩包上传

## 1. 失败分流与 package 存储地基

- [x] 1.1 postgres-migrations：`task_projection` 新增可空列 `failure_code`、`failure_detail`；`task_run_output` 新增 `package_bytes`（bytea）、`file_manifest`（jsonb），既有 `output` 文本列改为可空
- [x] 1.2 `task-domain`：`AgentSliceResult.outcome` 扩展 `'failed'`（携 `failureCode`/`detail`）；store 新增 `markSliceFailed`；`TaskRunOutputRecord` 扩展 package 字节与文件清单
- [x] 1.3 `task-store-postgres` 实现 `markSliceFailed`（effect ledger + 投影 `failed` 带错误码/明细）与 `writeRunOutput` 的 package 写入（登记 `output.tar.gz` + `#file/` 行）；存量纯文本行仍可读
- [x] 1.4 确认/补齐 `claimSlice` 对过期 claimed 行的可重入语义，补单测
- [x] 1.5 `TaskView` 透出 `failureCode`/`failureDetail`；task API 透传；`failed` 纳入可重试控制状态集合

## 2. 输出目录 → 打包 → 上传

- [x] 2.1 新增输出目录打包器（流式 tar+gzip）：只收相对路径、拒绝穿越/绝对路径/符号链接；条目 ≤256、解包 ≤16 MiB、单文件 ≤8 MiB、包 ≤20 MiB；超限抛 `PACKAGE_OUTPUT_LIMIT_EXCEEDED`
- [x] 2.2 `activities.ts`：slice 开始 `mkdtemp` 并注入 `SAGE_OUTPUT_DIR`；`finally` 删除临时目录
- [x] 2.3 `activities.ts`：移除对模型正文的 `enforceOutputContract`；成功后兼容回写（目录空且正文非空 → 首个 `output.files` 或 `output.md`）→ 校验声明文件存在（缺则 `PACKAGE_OUTPUT_MISSING_FILE`）→ 打包 → `writeRunOutput` 上传 package
- [x] 2.4 `output-contract.test.ts` 重写：声明 schema 与否物化等价（均不校验正文）；覆盖回写、缺文件失败、多文件+二进制入包、空目录无产物；保留 strip/unwrap/validate 工具函数测试
- [x] 2.5 worker 集成测试：多文件目录打成 `tar.gz` 且 `#file/` 可取回；确定性失败（`PROVIDER_DEPENDENCY_MISSING` / 缺文件 / 超限）终态 failed，无 `effect_unknown`

## 3. Artifact API 与任务 UI

- [x] 3.1 artifact 取回：package 行返回 `application/gzip` 字节；`#file/` 从 package 解出单条目（文本 utf-8 预览，否则 octet-stream）
- [x] 3.2 `tasks.tsx`：成功态展示 `output.tar.gz` 下载 + 文件清单；`TaskOutputPreview` 仅对 `text/*` 与 `application/json` 内联渲染；失败态展示 `failureCode + failureDetail`，重试可用
- [x] 3.3 `locale.tsx` 双语：输出 package、文件清单、下载、failed 明细
- [x] 3.4 web 测试：清单与预览分流、失败明细、aria

## 4. 源包压缩包解包器

- [x] 4.1 选型并引入 tar/zip 解析依赖，新增 `packages/agent-package-release/src/source-archive.ts`：魔数判型 + gzip 单层递归 + 深度上限 1
- [x] 4.2 条目级安全校验：拒绝穿越/绝对路径/符号链接/非常规条目；条目 ≤256、总体积 ≤4 MiB、单条目 ≤512 KiB；违规整体拒绝
- [x] 4.3 解包产物接入 `loadSourcePackageFromFiles` 同一管线
- [x] 4.4 负向测试集：路径穿越、符号链接、超限、损坏、纯文本 gzip、深层嵌套 gzip

## 5. 上传 API 与包管理 UI

- [x] 5.1 `apps-api.ts` 接入 `@fastify/multipart`（fileSize ≤8 MiB），同路由按 content-type 分流，multipart 走 `source-archive`；错误码稳定 4xx
- [x] 5.2 两通道一致性测试：JSON 通道 golden 逐字节等价；multipart 上传 tar.gz/tgz/tar/zip/gzip(内层tar) 登记成功；`APP_PACKAGE_ID_MISMATCH` 照常
- [x] 5.3 `packages.tsx` 改文件选择器 + 前端预检；locale 上传/格式错误文案
- [x] 5.4 web 测试：上传成功刷新版本历史、错误内联、aria

## 6. 示例 App 与收尾

- [x] 6.1 `platform/examples/ai-apps/` 与 `apps/agent-web/src/example-apps.ts`：finance-briefing / github-trending 移除「输出遵循 output.schema.json」提示词；`output.files` 保留为输出目录期望文件
- [ ] 6.2 端到端：本地栈重跑 finance-briefing——succeeded、权威产物为 `output.tar.gz`、包内含 `brief.md` 可预览；构造确定性失败验证 failed + 明细 + 可重试
- [x] 6.3 归档同步：主 spec 由本 change delta 归档生成；CHANGELOG/验证记录补齐
