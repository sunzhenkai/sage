# Tasks

## 1. 领域类型与端口

- [x] 1.1 在 `src/index.ts` 增加 `AppDraft`，扩展 `AgentApp`、`StoredRelease`（`sourceFiles?` / `sourceFilesDigest?`）与 `AgentReleaseStore` 的 `putAppDraft` / `updateAppMetadata` / `publishAppRelease` / `listAppReleases` 签名，并新增 `RELEASE_VERSION_CONFLICT` 错误码。验证：`corepack pnpm --filter @sage/agent-release-registry typecheck`
- [x] 1.2 定义草稿规范化与摘要 helper（排序文件、路径规范化、`sha256` 摘要、大小/secret 校验边界）。验证：新增单测覆盖路径穿越、超限与 secret 样例

## 2. 草稿存储

- [x] 2.1 `createApp` 写入 `revision: 0` 空草稿；`getApp` 返回草稿摘要；`listApps` 返回 `draftRevision` / `latestVersion` / `hasUnpublishedChanges` 所需字段。验证：`index.test.ts` 新建与详情断言
- [x] 2.2 实现 `putAppDraft`：`expectedRevision` 不匹配返回 `conflict`，匹配则递增 revision、更新 digest/updatedAt；软删 App 抛 `APP_DELETED`；写入前完成路径/大小/secret 校验。验证：单测覆盖冲突、成功递增、软删拒绝与非法路径
- [x] 2.3 实现 `updateAppMetadata`：与草稿共用 revision；`expectedRevision` 不匹配返回 `conflict`，匹配则更新 name/description 与 revision/updatedAt；软删 App 抛 `APP_DELETED`。验证：单测覆盖成功、冲突、软删拒绝与原字段保留

## 3. 发布与版本唯一

- [x] 3.1 实现 `publishAppRelease`：校验 `expectedRevision`、App active、写入 `sourceFiles/sourceFilesDigest`；同版本同内容返回 `existing`，同版本不同内容抛 `RELEASE_VERSION_CONFLICT`；在同步方法内完成检查与写入。验证：单测覆盖首次发布、幂等、冲突、revision 冲突、软删拒绝
- [x] 3.2 在既有 `submit` 路径加入同 App 同版本唯一检查，确保绕过 App 作用域也无法写入冲突版本；保留 `#ensurePlaceholderApp` 兼容内部 submit。验证：`index.test.ts` / `production-admission.test.ts` 通过
- [x] 3.3 实现 `listAppReleases`，按 `createdAt DESC, releaseId DESC` 返回；`getApp` 使用它组装 releases。验证：单测覆盖排序与租户隔离

## 4. 切片验证

- [x] 4.1 运行 `corepack pnpm --filter @sage/agent-release-registry test` 与 `typecheck`；把命令与结果写入 `proposal.md` 验证记录（若无验证记录节则新增）。验证：两条命令 exit 0
