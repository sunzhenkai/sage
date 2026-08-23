## Why
agent-web 的 Packages 域目前只有列表、详情查看与发起运行（见 `package-management-interface` spec 与已归档 agent-package-e2e-web change）。用户无法在 web 页面完成应用包的完整管理生命周期：新建一个包、更新其内容并发布新版本、上传源包文件、删除不再使用的包。当前登记/上传只能靠 CLI 脚本（`register-package.ts`）或 curl 完成，web 页面没有入口。

## What Changes
- 本 change 是 taskflow driver，不直接改代码，只编排子 change

## Non-goals
- 不做包内容在线编辑（manifest 等以源文件上传/登记为准，编辑器不属于本任务）
- 不做 active pointer / channel / rollback 治理 UI（release 发布策略治理另行立项）
- 不改变包详情页既有的发起运行、资产预览与 release 历史展示行为
- 不引入第三方上传/表单依赖，沿用现有 React + fetch 风格

## 涉及面
| 仓库 | 角色 | 说明 |
|------|------|------|
| . | 必须 | 会修改 platform/apps/agent-web，必要时扩展 platform/apps/agent-api 与 openspec specs，实施前切任务分支 |

## 验收标准
- [x] web 包列表页提供「新建包」入口，可创建新包（填写基本元信息，空源可后续上传）
- [x] web 支持上传源包文件并登记为 release（新建与更新均可），登记后版本化可见
- [x] web 包详情页提供「更新包/上传新版本」入口，提交后 release 历史新增版本
- [x] web 提供「删除包」操作，删除有确认与结果反馈，删除后列表消失
- [x] 后端具备必要的新建（占位包）与删除端点（或等价能力），且与既有注册/登记 API 风格一致
- [x] 全仓回归与静态检查通过（typecheck/lint/build/单测；本地栈 smoke 可选）

## Driver 协议
- 本 change 无 spec 增量（`.openspec.yaml` 已设 `skip_specs: true`）
- 子 change 一律命名 `{task}-<slice>`，与本 change 同一 planning root；跨 root 时在涉及面表显式记录 root 或 store id
- 实现进度只认子 change 自己的 `tasks.md`；本文件的 checkbox 只在对应子 change 全勾且 `validate --strict` 通过后才勾
- 涉及面里角色为 `必须` 的仓在实施前切任务分支；dirty 或 fetch 失败一律停下问用户，不自动 stash / reset / 强制切换
- 只有「checkbox 全勾」「需要用户决策」「本轮预算耗尽」三种情况允许结束一轮；单项做不了就保持未勾，在验证记录写一行原因后继续下一项
- 结束时逐条列出未勾项与原因，不按 change 汇总

## 验证记录

### 实施验证（2026-08-23，feat/agent-package-web-mgmt）

- **app-registry**：`platform/packages/agent-release-registry/src/index.ts` 新增 `AgentApp`/`AgentAppStatus`/`CreateAppRequest`/`AgentAppDetail` 类型与 `#apps` 索引；`AgentReleaseStore` 接口新增 `createApp`/`listApps`/`getApp`/`softDeleteApp`；审计 action 增加 `app-create`/`app-delete`，错误码增加 `APP_INVALID`/`APP_ALREADY_EXISTS`/`APP_NOT_FOUND`/`APP_DELETED`；`submit` 对缺失 App 隐式登记占位 App（向后兼容）。`InMemoryAgentReleaseStore` 实现四方法（createApp 冲突检测 + 软删 tombstone 拒绝重建；listApps 过滤 deleted 有界倒序；getApp 含 release 历史；softDeleteApp 幂等 + 审计）。单测 32/32 通过（新增 App 管理 9 用例：创建/冲突/非法输入/软删隐藏且保留 release/软删幂等/软删重建拒绝/getApp 含历史/隐式占位/租户隔离）。`openspec validate --strict --type change agent-package-web-mgmt-app-registry` 通过。
- **api**：新增 `platform/apps/agent-api/src/apps-api.ts`（`registerAppsRoutes`：`POST /v1/apps` 新建主体（appId 格式 + name/description 上界校验，冲突 409）、`GET /v1/apps` active 列表（join 最新 release 版本/时间/releaseCount）、`GET /v1/apps/{appId}` 详情（元信息 + manifest 摘要 + 资产预览 + release 历史，deleted→404）、`DELETE /v1/apps/{appId}` 幂等软删、`POST /v1/apps/{appId}/releases` 上传源包前置 App 存在/active + manifest.id 一致性校验后复用编译+登记链）。`packages-api.ts` 导出 `loadSourcePackageFromFiles`/`extractManifestSummary`/`extractAssetPreviews` 复用。index.ts 导出、runtime.ts 挂载。单测 9/9 通过（新建/冲突/非法 id/上传版本化/不存在/manifest 不一致/软删/未知字段/未认证）；packages-api/runs-api 无回归（20/20）。`openspec validate --strict --type change agent-package-web-mgmt-api` 通过。
- **web**：`platform/apps/agent-web/src/packages.tsx` 数据源切到 `/v1/apps` 端点，列表页新增「新建 App」入口与表单（appId/name/description，必填与 appId 格式校验，空态引导新建），详情页新增「上传新版本」表单（JSON files → 登记新版本自动刷新）与「删除 App」按钮（二次确认 + 删除后回列表），版本历史倒序展示，保留 manifest/资产/发起运行。`locale.tsx` 新增中英文案与 aria；`styles.css` 补 `task-list-heading-actions`/`detail-heading-actions`/`app-create-card`。agent-web 单测 116/116 通过（packages 测试扩到 9 用例：列表渲染/新建成功+非法 id 拦截/上传成功+缺 app.yaml 拦截/删除确认/详情渲染/发起运行输入校验）。`openspec validate --strict --type change agent-package-web-mgmt-web` 通过。

### 全仓回归（2026-08-23）

- `pnpm typecheck`（platform 全仓）通过
- `pnpm lint`（platform 全仓，`--max-warnings=0`）通过
- `pnpm build`（platform 全仓）通过
- `node scripts/check-dependencies.mjs`：Dependency boundaries OK
- `pnpm test`（全仓）：822 通过 / 60 跳过 / **2 个既有失败**：
  - `scripts/agent-platform-final/final.test.ts > preflight is truthfully blocked by production external evidence`：与 flash-fix 验证记录载明的既有失败同一根因（HEAD 归档后 openspec 状态与 `entry-preflight.json` 未同步）。已在剥离本 change 全部改动的干净树上复现确认，非本 change 引入。
  - `packages/agent-package-release/src/source-loader.test.ts > covers every fixture directory with an expected outcome`：测试期望 `missing-manifest` fixture 目录，但 HEAD 中本就不存在该 fixture（`git cat-file -e HEAD:...missing-manifest/app.yaml` 确认不存在）。已在干净树上复现确认，非本 change 引入。
  - 两个既有失败均与本 change 改动面（registry store / agent-api / agent-web）无关。

> 注：`pnpm test` 运行时 `agent-platform-final` 套件会重写 `platform/evidence/agent-platform-final/*.json`（checkedAt 更新），为套件既有副作用；提交前已 `git checkout -- platform/evidence/` 还原，不纳入本 change 提交。
