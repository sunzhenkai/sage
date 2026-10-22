# Tasks

## 1. 架构文档

- [x] 1.1 把 `platform/architecture/app-package-run-model.md` 重命名为 `app-release-run-model.md`；更新实体表（App / Draft / Release / Run）、API 表、不变量与生命周期图，删除 Package 实体描述。验证：`rg -n "Package" platform/architecture/app-release-run-model.md` 仅剩兼容名说明
- [x] 1.2 在新文档增加「兼容名与后续」一节：`ReleasePayload.packageId/packageVersion`、`task_package_input`、`PackageRunResult.v1` 保留；Postgres 持久化、channel、权限列为后续。验证：文档中每个兼容名都有去处说明
- [x] 1.3 检查仓库内指向旧文件名的链接并更新。验证：`rg -n "app-package-run-model" --glob '!**/node_modules/**' --glob '!**/dist/**'` 无结果

## 2. 能力规格

- [x] 2.1 新增 `specs/app-release-management/spec.md`（ADDED Requirements）：App 唯一写入口、草稿 revision/If-Match、草稿导入导出、发布与版本唯一、Release 不可变与源快照、source/bundle 下载、运行准入与软删拒绝、FIXED/FOLLOW 调度、`/v1/packages*` 移除。每个 Requirement 至少一个 Scenario。验证：`openspec validate sage-app-package-model-docs --strict` 通过
- [x] 2.2 新增 `specs/agent-web-example-app-import/spec.md`（MODIFIED Requirements）：导入流程改为 create → PUT draft → publish；已存在不覆盖；失败重试复用草稿。验证：`openspec show sage-app-package-model-docs --json` 列出两个 spec delta

## 3. 示例说明

- [x] 3.1 更新 `platform/examples/ai-apps/README.md`：登记命令改为 `register-package <dir>`（内部走 App 草稿/发布），响应示例改为 `AppReleaseResult.v1`，删除 `/v1/packages` 与 `PackageReleaseResult.v1`。验证：`rg -n "/v1/packages|PackageReleaseResult" platform/examples/ai-apps/README.md` 无结果

## 4. 切片验证

- [x] 4.1 运行 `openspec validate sage-app-package-model-docs --strict` 与 `corepack pnpm exec openspec validate agent-web-example-app-import --strict`（若该命令不适用则记录原因），结果写入 `proposal.md` 验证记录。验证：命令 exit 0
