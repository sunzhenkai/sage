# sage-app-package-model-docs

## Why

代码收敛后，架构文档、能力规格与示例说明必须同步，否则 Package 仍是事实上的第二模型。方案见 `~/code/tasks/ongoing/sage-app-package-model/design/app-release-model.md` §9.3、§10.3。

## What Changes

- `platform/architecture/app-package-run-model.md` 重命名为 `app-release-run-model.md`：更新实体、API 表、不变量、当前限制（内存态）、兼容名（`packageId` / `packageVersion` / `task_package_input`）。
- 新增 OpenSpec 能力 `app-release-management`，覆盖 App 生命周期、草稿 revision、发布/版本唯一、不可变 Release、下载、运行准入、调度 FOLLOW、Packages 移除。
- 修改既有 `agent-web-example-app-import` 规格：导入改为 create → draft → publish，已存在不覆盖。
- 更新 `platform/examples/ai-apps/README.md` 的登记命令与响应示例（`AppReleaseResult.v1`，不再引用 `/v1/packages`）。

## Non-goals

- 不改代码行为（由前序切片完成）。
- 不改 `generic-agent-platform-final-architecture.md` 的目标态模型（只在新文档中标注当前实现与目标态差异）。
- 不做用户权限、持久化、channel 等后续能力的规格。

## 涉及面

| 仓库 | 角色 | 说明 |
|------|------|------|
| repos/github/sunzhenkai/sage | 必须 | `platform/architecture/`、`openspec/specs/`、`openspec/changes/sage-app-package-model-docs/specs/`、`platform/examples/ai-apps/README.md` |

## 验收标准

- [x] `openspec validate sage-app-package-model-docs --strict` 通过；归档后 `openspec/specs/app-release-management/spec.md` 存在且引用新模型。
- [x] 架构文档不再以 Package 作为实体；兼容名集中在一节说明；示例 README 不再出现 `/v1/packages`。

## 验证记录

- 架构文档：`platform/architecture/app-package-run-model.md` 重命名为 `platform/architecture/app-release-run-model.md`，实体表改为 App / Draft / Release / Run / Task，新增 §8「兼容名与后续」。`rg -n "Package" platform/architecture/app-release-run-model.md` 仅命中兼容名（`packageId`/`packageVersion`、`task_package_input`、`PackageRunResult.v1`）与内部函数名（`loadSourcePackageFromFiles`、`compileSourcePackage`、`admitPackageRun`）。
- 旧文件名引用：仓库内无 Markdown 链接指向 `app-package-run-model.md`；`rg` 仅命中本 change 自身的 `tasks.md` / `proposal.md` 文字说明（描述重命名动作，不指向文件）。
- 能力规格：`openspec show sage-app-package-model-docs --json` 列出两个 spec delta —— `app-release-management`（ADDED，8 条 Requirement）与 `agent-web-example-app-import`（MODIFIED，3 条 Requirement）；每条均含 Scenario。
- 示例说明：`platform/examples/ai-apps/README.md` 登记流程描述为 create → PUT draft → publish，响应示例更新为 `AppReleaseResult.v1`；`rg -n "/v1/packages|PackageReleaseResult" platform/examples/ai-apps/README.md` 无结果。
- 校验命令：`openspec validate sage-app-package-model-docs --strict` → valid；`openspec validate agent-web-example-app-import --strict` → valid。任务中的 `corepack pnpm exec openspec validate ...` 不适用：OpenSpec 仓根不在 pnpm workspace（`ERR_PNPM_RECURSIVE_EXEC_NO_PACKAGE`），改用全局 `openspec validate` 完成同等校验。
